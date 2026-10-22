import { nextAttempt, stageError } from './attempts';
import { type AnalyzeMessage } from './messages';
import { SYSTEM_PROMPT } from './prompt';
import { overallScore, parseModelJson, type StageInput, type StageScore } from './score';

const STOP = new Set(['completed', 'failed', 'skipped_short', 'skipped_no_duration', 'recording_missing']);
const DONT_REOPEN = new Set(['failed', 'skipped_short', 'skipped_no_duration', 'recording_missing']);

export type ScriptInput = { title: string; body: string };

export type AnalysisState = {
  processing_status: string;
  transcript: unknown;
  overall_score: number | null;
};

export type ScoreWrite = {
  inputs: ScriptInput[];
  stages: StageScore[];
  summary: string;
  overall: number;
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
  loadStages: (projectId: string) => Promise<StageInput[] | null>;
  loadScripts: (projectId: string) => Promise<ScriptInput[]>;
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
  if (state.overall_score !== null && state.overall_score !== undefined) {
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
    if (!Array.isArray(state.transcript) || state.transcript.length === 0) {
      return retryOrFail(message, deps, 'transcript_missing');
    }
    const stages = await deps.loadStages(message.project_id);
    if (!stages) {
      return retryOrFail(message, deps, 'model_unavailable');
    }
    const scripts = await deps.loadScripts(message.project_id);
    const payload = {
      scripts,
      transcript: state.transcript,
      stages: stages.map((stage) => ({
        key: stage.key,
        title: stage.title,
        weight: stage.weight,
        instruction: stage.instruction,
      })),
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
    const parsed = parseModelJson(result.content, stages);
    if (!parsed.ok) {
      return retryOrFail(message, deps, 'invalid_model_json');
    }
    const overall = overallScore(parsed.stages);
    if (!Number.isInteger(overall) || overall < 0 || overall > 100) {
      return retryOrFail(message, deps, 'invalid_model_json');
    }
    const model = result.model.trim() || deps.model;
    const wrote = await deps.save(message.call_id, {
      inputs: scripts,
      stages: parsed.stages,
      summary: parsed.summary,
      overall,
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
