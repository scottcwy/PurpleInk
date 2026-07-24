const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
const escapeHtml = (value = "") => value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
const seconds = (milliseconds) => Number((milliseconds / 1000).toFixed(3)).toString();
const evidenceRefKey = (ref) => ref.kind === "node_evidence"
  ? `node_evidence:${ref.nodeEvidenceId}:${ref.assetVersionId}`
  : `source_asset:${ref.sourceAssetId}:${ref.assetVersionId}`;
const evidenceRefId = (ref) => ref.kind === "node_evidence" ? ref.nodeEvidenceId : ref.sourceAssetId;

function evidenceElement(beat, entry, index, beatIndex, isLast) {
  const transitionTail = isLast ? 0 : 450;
  const duration = beat.durationMs + transitionTail;
  const className = `clip evidence ${escapeHtml(beat.layoutId)} evidence-${index}`;
  const common = `id="media-${escapeHtml(beat.id)}-${index}" class="${className}" data-start="${seconds(beat.startMs)}" data-duration="${seconds(duration)}" data-track-index="${10 + beatIndex * 2 + index}" data-evidence-id="${escapeHtml(evidenceRefId(entry.ref))}"`;
  const source = escapeHtml(entry.bundlePath);
  if (entry.mimeType.startsWith("video/")) return `<video ${common} src="${source}" muted playsinline></video>`;
  return `<img ${common} src="${source}" alt="Approved product evidence" crossorigin="anonymous" />`;
}

function beatElement(beat, index) {
  const headline = beat.headline ? `<h1>${escapeHtml(beat.headline)}</h1>` : "";
  const body = beat.body ? `<p>${escapeHtml(beat.body)}</p>` : "";
  return `<section id="beat-${escapeHtml(beat.id)}" class="clip beat beat-${escapeHtml(beat.layoutId)}" data-start="${seconds(beat.startMs)}" data-duration="${seconds(beat.durationMs)}" data-track-index="${100 + index}" data-motion="${escapeHtml(beat.motionPresetId)}" data-transition="${escapeHtml(beat.transitionId)}"><div class="copy">${headline}${body}<span class="proof-label">Verified evidence</span></div></section>`;
}

function animationScript(beats) {
  const animations = beats.map((beat) => {
    const copyFrames = beat.motionPresetId === "proof-pop" ? `[{opacity:0,transform:"scale(.96)"},{opacity:1,transform:"scale(1)"}]` : `[{opacity:0,transform:"translateY(30px)"},{opacity:1,transform:"translateY(0)"}]`;
    const mediaFrames = beat.transitionId === "soft-wipe" ? `[{clipPath:"inset(0 100% 0 0)",transform:"scale(1.025)"},{clipPath:"inset(0 0 0 0)",transform:"scale(1)"}]` : `[{opacity:0,transform:"scale(1.018)"},{opacity:1,transform:"scale(1)"}]`;
    const mediaAnimations = beat.evidence.map((_, index) => `document.getElementById(${JSON.stringify(`media-${beat.id}-${index}`)}).animate(${mediaFrames},{duration:520,delay:${beat.startMs + index * 80},fill:"both",easing:"cubic-bezier(.16,1,.3,1)"});`).join("\n");
    return `document.getElementById(${JSON.stringify(`beat-${beat.id}`)}).querySelector(".copy").animate(${copyFrames},{duration:560,delay:${beat.startMs + 180},fill:"both",easing:"cubic-bezier(.16,1,.3,1)"});\n${mediaAnimations}`;
  }).join("\n");
  return `<script>
window.__timelines = window.__timelines || {};
${animations}
</script>`;
}

export function renderFeatureLaunch({ plan, variant, evidenceByReference, brandKit }) {
  const media = [];
  const copy = [];
  plan.beats.forEach((beat, beatIndex) => {
    beat.evidence.forEach((use, evidenceIndex) => media.push(evidenceElement(beat, evidenceByReference.get(evidenceRefKey(use)), evidenceIndex, beatIndex, beatIndex === plan.beats.length - 1)));
    copy.push(beatElement(beat, beatIndex));
  });
  const colors = {
    paper: brandKit.colors.paper ?? "#FAF9FE", ink: brandKit.colors.ink ?? "#12101C", purple: brandKit.colors.purple ?? "#7D3DF3",
    proof: brandKit.colors.proof ?? "#00C37A", proofInk: brandKit.colors.proofInk ?? "#002C13", panel: brandKit.colors.inkPanel ?? "#0B0914", panelText: brandKit.colors.inkPanelText ?? "#F5F4FA"
  };
  const portrait = variant.id === "portrait";
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${variant.width},height=${variant.height}"><title>PurpleInk Feature Launch</title>
<style>
@font-face{font-family:"${escapeHtml(brandKit.fonts.display)}";src:local("${escapeHtml(brandKit.fonts.display)}"),local("Arial")}@font-face{font-family:"${escapeHtml(brandKit.fonts.body)}";src:local("${escapeHtml(brandKit.fonts.body)}"),local("Arial")}@font-face{font-family:"${escapeHtml(brandKit.fonts.mono)}";src:local("${escapeHtml(brandKit.fonts.mono)}"),local("Courier New")}
*{box-sizing:border-box}html,body{margin:0;width:${variant.width}px;height:${variant.height}px;overflow:hidden;background:${colors.panel};font-family:${escapeHtml(brandKit.fonts.body)},Arial,sans-serif}#root{position:relative;width:100%;height:100%;overflow:hidden;background:${colors.panel}}
.evidence{position:absolute;margin:0;z-index:1;object-fit:cover;background:${colors.paper};border:0}.beat{position:absolute;inset:0;z-index:3;display:flex;padding:${portrait ? "104px 72px 128px" : "72px 112px"};pointer-events:none}.copy{display:flex;flex-direction:column;justify-content:center;gap:${portrait ? 26 : 20}px;max-width:${portrait ? 900 : 720}px;color:${colors.panelText}}h1{margin:0;font-family:${escapeHtml(brandKit.fonts.display)},Arial,sans-serif;font-size:${portrait ? 88 : 76}px;line-height:1;letter-spacing:0;font-weight:720;text-wrap:balance}p{margin:0;max-width:680px;font-size:${portrait ? 34 : 28}px;line-height:1.35;letter-spacing:0}.proof-label{align-self:flex-start;margin-top:8px;padding:10px 16px;border-radius:999px;background:${colors.proof};color:${colors.proofInk};font-family:${escapeHtml(brandKit.fonts.mono)},monospace;font-size:${portrait ? 22 : 17}px;font-weight:700;letter-spacing:0}
.evidence-full{inset:0;width:100%;height:100%;filter:brightness(.48)}.beat-evidence-full{align-items:flex-end;background:linear-gradient(0deg,rgba(11,9,20,.88),rgba(11,9,20,.02) 72%)}.beat-evidence-full .copy{justify-content:flex-end;padding-bottom:${portrait ? 90 : 44}px}
.evidence-split{top:${portrait ? 80 : 92}px;right:${portrait ? 64 : 88}px;width:${portrait ? 952 : 1000}px;height:${portrait ? 1160 : 760}px;object-fit:contain;border-radius:16px;background:${colors.paper}}.beat-evidence-split{align-items:${portrait ? "flex-end" : "center"};justify-content:flex-start}.beat-evidence-split .copy{width:${portrait ? "100%" : "38%"};padding-bottom:${portrait ? 50 : 0}px}.beat-evidence-split+.beat{}
.evidence-detail{top:${portrait ? 130 : 110}px;left:${portrait ? 68 : 560}px;width:${portrait ? 944 : 1240}px;height:${portrait ? 1260 : 820}px;object-fit:contain;border-radius:14px;background:${colors.paper}}.beat-evidence-detail{align-items:flex-start;justify-content:flex-start}.beat-evidence-detail .copy{max-width:${portrait ? 920 : 600}px;background:${colors.purple};padding:${portrait ? 42 : 32}px;border-radius:14px;color:#FCFBFF}
</style></head><body><main id="root" data-composition-id="feature-launch-${variant.id}" data-start="0" data-duration="${seconds(plan.durationMs)}" data-width="${variant.width}" data-height="${variant.height}" data-no-timeline>${media.join("")}${copy.join("")}</main>${animationScript(plan.beats)}</body></html>`;
}

export function hyperframesConfig() {
  return `${JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: false } }, null, 2)}\n`;
}
