#!/usr/bin/env node

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectDir = resolve(process.argv[2] || ".");
const request = JSON.parse(readFileSync(join(projectDir, "audio_request.json"), "utf8"));
const storyboard = readFileSync(join(projectDir, "STORYBOARD.md"), "utf8");
const voice = process.env.MACOS_TTS_VOICE || "Sandy (中文（中国大陆）)";
const baseRate = Number(process.env.MACOS_TTS_RATE || 185);
const workDir = mkdtempSync(join(tmpdir(), "stepfun-macos-tts-"));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  return result.stdout;
}

function probeDuration(path) {
  return Number(
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      path,
    ]).trim(),
  );
}

function frameDurations(markdown) {
  const durations = new Map();
  let frame = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^## Frame (\d+)/);
    if (heading) frame = Number(heading[1]);
    const duration = line.match(/^\s*- duration:\s*([\d.]+)s/);
    if (frame && duration) durations.set(frame, Number(duration[1]));
  }
  return durations;
}

function segmentWords(text) {
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const words = [];
  for (const { segment } of segmenter.segment(text)) {
    if (!segment.trim()) continue;
    if (/^[，。！？、,.!?：:；;]$/u.test(segment) && words.length) {
      words[words.length - 1] += segment;
    } else {
      words.push(segment);
    }
  }
  return words;
}

function wordTimings(text, speechDuration) {
  const words = segmentWords(text);
  const weights = words.map((word) => Math.max(1, [...word].length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return words.map((word, index) => {
    const start = cursor;
    cursor += (speechDuration * weights[index]) / totalWeight;
    return {
      id: `w${index}`,
      text: word,
      start: Number(start.toFixed(3)),
      end: Number(cursor.toFixed(3)),
    };
  });
}

const planned = frameDurations(storyboard);
const voiceDir = join(projectDir, "assets", "voice");
mkdirSync(voiceDir, { recursive: true });
const voices = [];

try {
  for (const line of request.lines || []) {
    const id = String(line.id).padStart(2, "0");
    const frame = Number(id);
    const targetDuration = planned.get(frame);
    if (!targetDuration) throw new Error(`No planned duration for frame ${frame}`);

    const rawPath = join(workDir, `${id}.aiff`);
    let rate = baseRate;
    let speechDuration = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      run("say", ["-v", voice, "-r", String(rate), "-o", rawPath, String(line.text)]);
      speechDuration = probeDuration(rawPath);
      if (speechDuration <= targetDuration - 0.2) break;
      rate = Math.ceil((rate * speechDuration) / (targetDuration - 0.3));
    }
    if (speechDuration > targetDuration) {
      throw new Error(`Frame ${frame} narration is ${speechDuration.toFixed(2)}s, over ${targetDuration}s`);
    }

    const relativePath = `assets/voice/${id}.wav`;
    const outputPath = join(projectDir, relativePath);
    run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      rawPath,
      "-af",
      "apad",
      "-t",
      String(targetDuration),
      "-ar",
      "44100",
      "-ac",
      "1",
      outputPath,
    ]);

    voices.push({
      id,
      path: relativePath,
      duration_s: targetDuration,
      words: wordTimings(String(line.text), speechDuration),
    });
    console.log(`voice ${id}: ${speechDuration.toFixed(2)}s speech + hold -> ${targetDuration.toFixed(2)}s`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const totalDuration = voices.reduce((sum, item) => sum + item.duration_s, 0);
const neutral = {
  tts_provider: "macos-say",
  voice_id: voice,
  bgm: null,
  bgm_pending: false,
  bgm_provider: null,
  bgm_pid: null,
  bgm_log: null,
  bgm_mode: "none",
  bgm_target_duration_s: null,
  bgm_seed_duration_s: null,
  bgm_loop_count: null,
  voices,
  sfx: [],
  total_duration_s: totalDuration,
  anomalies: [],
};
const product = {
  bgm: null,
  voices: voices.map((item) => ({
    frame: Number(item.id),
    path: item.path,
    duration_s: item.duration_s,
    words: item.words,
  })),
  sfx: [],
};

writeFileSync(join(projectDir, "audio_engine_meta.json"), JSON.stringify(neutral, null, 2));
writeFileSync(join(projectDir, "audio_meta.json"), JSON.stringify(product, null, 2));
console.log(`generated ${voices.length} voices (${totalDuration.toFixed(2)}s) with ${voice}`);
