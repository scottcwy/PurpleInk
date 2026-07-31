/** MPEG1 Layer III / 32 kHz / 单声道 / 32 kbps 的最小可同步帧序列。 */
export function mp3Frames(count: number): Buffer {
  const frameLength = Math.floor((1152 / 8) * (32_000 / 32_000))
  const frame = Buffer.alloc(frameLength)
  frame[0] = 0xff
  frame[1] = 0xfb // MPEG1, Layer III, 无 CRC
  frame[2] = 0x18 // bitrate index 1 (32 kbps), sample rate index 2 (32 kHz)
  frame[3] = 0xc0 // 单声道
  return Buffer.concat(Array.from({ length: count }, () => frame))
}
