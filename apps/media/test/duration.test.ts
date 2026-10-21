import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readAudioDuration, wholeSeconds } from '../src/duration';

function wav(seconds: number, sampleRate = 8000): Buffer {
  const dataSize = Math.round(seconds * sampleRate) * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function id3Tlen(ms: number, rest: Buffer): Buffer {
  const text = Buffer.from(String(ms), 'latin1');
  const frameBody = Buffer.concat([Buffer.from([0]), text]);
  const frame = Buffer.alloc(10 + frameBody.length);
  frame.write('TLEN', 0);
  frame.writeUInt32BE(frameBody.length, 4);
  frameBody.copy(frame, 10);
  const header = Buffer.alloc(10);
  header.write('ID3', 0);
  header[3] = 3;
  const size = frame.length;
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  return Buffer.concat([header, frame, rest]);
}

function mp3Frames(count: number): Buffer {
  const length = Math.floor((72 * 64_000) / 8000);
  const frame = Buffer.alloc(length);
  frame[0] = 0xff;
  frame[1] = 0xe3;
  frame[2] = 0x88;
  frame[3] = 0x00;
  return Buffer.concat(Array.from({ length: count }, () => Buffer.from(frame)));
}

function oggPage(granule: bigint, packet: Buffer): Buffer {
  const header = Buffer.alloc(28);
  header.write('OggS', 0);
  header.writeBigInt64LE(granule, 6);
  header.writeUInt32LE(1, 14);
  header[26] = 1;
  header[27] = packet.length;
  return Buffer.concat([header, packet]);
}

describe('audio duration', () => {
  it('reads seconds from the file when the container has no duration tag', () => {
    const read = readAudioDuration(wav(1));
    assert.equal(read?.via, 'file');
    assert.equal(wholeSeconds(read?.seconds ?? -1), 1);
  });

  it('prefers duration metadata over the audio frames', () => {
    const frames = mp3Frames(28);
    const fromFile = readAudioDuration(frames);
    assert.equal(fromFile?.via, 'file');
    assert.equal(wholeSeconds(fromFile?.seconds ?? -1), 2);
    const tagged = id3Tlen(10_000, frames);
    const fromTag = readAudioDuration(tagged);
    assert.equal(fromTag?.via, 'metadata');
    assert.equal(wholeSeconds(fromTag?.seconds ?? -1), 10);
  });

  it('reads an ogg granule as file duration', () => {
    const id = Buffer.alloc(30);
    id[0] = 1;
    id.write('vorbis', 1);
    id[11] = 1;
    id.writeUInt32LE(44100, 12);
    const bytes = Buffer.concat([oggPage(0n, id), oggPage(44100n, Buffer.from([0]))]);
    const read = readAudioDuration(bytes);
    assert.equal(read?.via, 'file');
    assert.equal(wholeSeconds(read?.seconds ?? -1), 1);
  });

  it('returns nothing when neither metadata nor the file has a duration', () => {
    assert.equal(readAudioDuration(Buffer.from('not-audio')), null);
    assert.equal(wholeSeconds(Number.NaN), null);
  });
});
