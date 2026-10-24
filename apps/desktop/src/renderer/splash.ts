import type { BootStatus, BootStepState } from "../shared";
import { Presence } from "./presence";
import { el, hydrateIcons } from "./ui";

// What each step's failure code means for the operator, and what to do about it.
const FAILURES: Record<string, string> = {
  ENV_MISSING: ".env bulunamadı. Tekrar dene ile dosyayı seçin.",
  TOKEN_MISSING: ".env içinde JARVIS_TOKEN yok.",
  PORT_INVALID: ".env içindeki PORT geçersiz.",
  CORE_NOT_BUILT: "Çekirdek derlenmemiş: depoda npm run build çalıştırın.",
  CORE_EXITED: "Çekirdek açılırken kapandı. Ayrıntı: logs\\core.log",
  CORE_TIMEOUT: "Çekirdek 90 saniyede yanıt vermedi. Ayrıntı: logs\\core.log",
  CORE_UNREACHABLE: "Çekirdeğe ulaşılamadı.",
  DATABASE_TIMEOUT:
    "Veritabanına ulaşılamadı. İnternet bağlantısını kontrol edin; Supabase projesi bir hafta kullanılmayınca duraklar, panelden Restore ile açılır.",
  OPENCLAW_EXITED: "OpenClaw açılırken kapandı. Ayrıntı: logs\\openclaw.log",
  OPENCLAW_TIMEOUT: "OpenClaw 3 dakikada açılmadı. Ayrıntı: logs\\openclaw.log",
  OPENCLAW_UNREACHABLE: "OpenClaw ağ geçidine ulaşılamadı.",
  VOICE_UNAVAILABLE: "Ses servisi başlatılamadı.",
};
const WORDS: Record<BootStepState, string> = {
  waiting: "Sırada",
  running: "Kontrol ediliyor",
  ready: "Hazır",
  skipped: "Kapalı",
  failed: "Başarısız",
};

hydrateIcons();
const presence = new Presence(el<HTMLCanvasElement>("[data-presence]"));
presence.setState("thinking");
const list = el<HTMLOListElement>("[data-steps]");
const line = el("[data-line]");
const progress = el("[data-progress]");
const bar = el("[data-bar]");
const error = el("[data-error]");
const actions = el("[data-actions]");
const retry = el<HTMLButtonElement>("[data-retry]");

function render(status: BootStatus) {
  const mood = { running: "thinking", ready: "listening", failed: "error" } as const;
  document.body.dataset.phase = status.phase;
  document.body.dataset.state = mood[status.phase];
  presence.setState(mood[status.phase]);
  line.textContent = {
    running: "Sistemler hazırlanıyor",
    ready: "Tüm sistemler çevrimiçi",
    failed: "Bir bağlantı kurulamadı",
  }[status.phase];
  const done = status.steps.filter((step) => ["ready", "skipped"].includes(step.state)).length;
  const percent = Math.round((done / Math.max(1, status.steps.length)) * 100);
  bar.style.width = `${percent}%`;
  progress.setAttribute("aria-valuenow", String(percent));
  list.replaceChildren(
    ...status.steps.map((step) => {
      const item = document.createElement("li");
      item.dataset.state = step.state;
      item.dataset.step = step.id;
      const mark = document.createElement("span");
      mark.className = "boot-dot";
      mark.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "boot-label";
      label.textContent = step.label;
      const detail = document.createElement("span");
      detail.className = "boot-detail";
      // A failure's message goes below the list; its row keeps the short word.
      detail.textContent =
        step.state === "failed" || !step.detail ? WORDS[step.state] : step.detail;
      item.append(mark, label, detail);
      return item;
    }),
  );
  const failed = status.steps.filter((step) => step.state === "failed");
  error.hidden = failed.length === 0;
  error.textContent = failed
    .map((step) => `${step.label}: ${FAILURES[step.detail ?? ""] ?? step.detail ?? ""}`)
    .join("\n");
  actions.hidden = status.phase !== "failed";
  retry.disabled = status.phase === "running";
  if (status.phase === "failed") retry.focus();
}

window.jarvis.boot.onStatus(render);
retry.addEventListener("click", () => {
  retry.disabled = true;
  window.jarvis.boot.retry();
});
for (const button of document.querySelectorAll("[data-quit]"))
  button.addEventListener("click", () => window.jarvis.quit());
