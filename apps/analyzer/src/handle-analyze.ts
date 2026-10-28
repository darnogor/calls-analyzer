import { nextAttempt, stageError } from './attempts';
import { type AnalyzeMessage } from './messages';
import { SYSTEM_PROMPT } from './prompt';
import {
  coverageRatio,
  isPreliminary,
  parseModelJson,
  qualityScore,
  type PaymentAgreement,
  type StageInput,
  type StageResult,
  type ViolationFlag,
} from './score';
import { transcriptTurns } from './transcript';

const STOP = new Set(['completed', 'failed', 'skipped_short', 'skipped_no_duration', 'recording_missing']);
const DONT_REOPEN = new Set(['failed', 'skipped_short', 'skipped_no_duration', 'recording_missing']);

export type ScorecardInput = {
  cardKey: string | null;
  stages: StageInput[];
};

export type CallParties = {
  manager: { name: string } | null;
  client: { name: string; company: string | null } | null;
};

export type AnalysisState = CallParties & {
  processing_status: string;
  transcript: unknown;
  overall_score: number | null;
  analyzed: boolean;
};

export type ScoreWrite = {
  inputs: {
    card_key: string | null;
    scoring_prompt: string;
    product_facts: string;
    manager: { name: string } | null;
    client: { name: string; company: string | null } | null;
  };
  stages: StageResult[];
  overall: number | null;
  extras: {
    coverage: number | null;
    preliminary: boolean;
    flags: ViolationFlag[];
    payment_agreement: PaymentAgreement;
  };
  model: string;
};

export type HandleResult = { action: 'ack' } | { action: 'retry'; message: AnalyzeMessage };

export type Complete = (input: {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}) => Promise<{ model: string; content: string }>;

export type AnalyzeDeps = {
  now: () => string;
  newId: () => string;
  model: string;
  load: (projectId: string, callId: string) => Promise<AnalysisState | null>;
  loadScorecard: (projectId: string) => Promise<ScorecardInput | null>;
  loadPrompt: (projectId: string) => Promise<string>;
  loadFacts: (projectId: string) => Promise<string>;
  markAnalyzing: (projectId: string, callId: string) => Promise<void>;
  save: (callId: string, score: ScoreWrite) => Promise<boolean>;
  markCompleted: (projectId: string, callId: string) => Promise<void>;
  fail: (projectId: string, callId: string, error: ReturnType<typeof stageError>) => Promise<void>;
  complete: Complete;
};

export async function handleAnalyze(message: AnalyzeMessage, deps: AnalyzeDeps): Promise<HandleResult> {
  const state = await deps.load(message.project_id, message.call_id);
  if (!state) {
    return retryOrFail(message, deps, 'transcript_missing');
  }
  if (state.analyzed) {
    if (!DONT_REOPEN.has(state.processing_status)) {
      await deps.markCompleted(message.project_id, message.call_id);
    }
    return { action: 'ack' };
  }
  if (STOP.has(state.processing_status)) {
    return { action: 'ack' };
  }
  try {
    await deps.markAnalyzing(message.project_id, message.call_id);
    const turns = transcriptTurns(state.transcript);
    if (!turns) {
      return retryOrFail(message, deps, 'transcript_missing');
    }
    const scorecard = await deps.loadScorecard(message.project_id);
    if (!scorecard || scorecard.stages.length === 0) {
      return retryOrFail(message, deps, 'scorecard_missing');
    }
    const scoringPrompt = await deps.loadPrompt(message.project_id);
    const productFacts = await deps.loadFacts(message.project_id);
    const parties: CallParties = { manager: state.manager, client: state.client };
    const payload = {
      scorecard: {
        key: scorecard.cardKey,
        stages: scorecard.stages.map((stage) => ({
          key: stage.key,
          title: stage.title,
          weight: stage.weight,
          high_score: stage.high_score,
          defect_example: stage.defect_example,
          sample_line: stage.sample_line,
        })),
      },
      prompt: scoringPrompt,
      product_facts: productFacts,
      manager: parties.manager,
      client: parties.client,
      transcript: turns,
    };
    let result: { model: string; content: string };
    try {
      result = await deps.complete({
        model: deps.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      });
    } catch (error) {
      console.error('analyze', message.call_id, error);
      return retryOrFail(message, deps, 'model_unavailable');
    }
    const ids = new Set(turns.map((turn) => turn.id));
    const parsed = parseModelJson(result.content, scorecard.stages, ids);
    if (!parsed.ok) {
      return retryOrFail(message, deps, 'invalid_model_json');
    }
    const overall = qualityScore(parsed.value.stages);
    if (overall !== null && (!Number.isInteger(overall) || overall < 0 || overall > 100)) {
      return retryOrFail(message, deps, 'invalid_model_json');
    }
    const model = result.model.trim() || deps.model;
    const wrote = await deps.save(message.call_id, {
      inputs: {
        card_key: scorecard.cardKey,
        scoring_prompt: scoringPrompt,
        product_facts: productFacts,
        manager: parties.manager,
        client: parties.client,
      },
      stages: parsed.value.stages,
      overall,
      extras: {
        coverage: coverageRatio(parsed.value.stages),
        preliminary: isPreliminary(parsed.value.stages),
        flags: parsed.value.flags,
        payment_agreement: parsed.value.payment_agreement,
      },
      model,
    });
    if (wrote) {
      await deps.markCompleted(message.project_id, message.call_id);
    }
    return { action: 'ack' };
  } catch (error) {
    console.error('analyze', message.call_id, error);
    return retryOrFail(message, deps, 'model_unavailable');
  }
}

async function retryOrFail(message: AnalyzeMessage, deps: AnalyzeDeps, code: string): Promise<HandleResult> {
  const retry = nextAttempt(message, deps.now(), deps.newId());
  if (retry) {
    return { action: 'retry', message: retry };
  }
  await deps.fail(message.project_id, message.call_id, stageError('analyze', code, message.attempt, deps.now()));
  return { action: 'ack' };
}
