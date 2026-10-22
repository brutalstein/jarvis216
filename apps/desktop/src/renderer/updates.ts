import type { UpdateState } from "../shared";
import { el } from "./ui";

export function updates() {
  const dialog = el<HTMLDialogElement>("#updates-dialog");
  const status = el("#updates-status");
  const action = el<HTMLButtonElement>("#updates-action");
  let phase: UpdateState["phase"] = "idle";
  function render(state: UpdateState) {
    phase = state.phase;
    const messages: Record<UpdateState["phase"], string> = {
      unsupported: "Kurulu Windows sürümünde kullanılabilir. Geliştirme kopyası güncellenmez.",
      idle: "GitHub üzerindeki yeni sürümü denetleyebilirsiniz.",
      checking: "Güncellemeler denetleniyor…",
      current: "En güncel sürüm kurulu.",
      available: `${state.next ?? "Yeni sürüm"} indirilmeye hazır.`,
      downloading: `İndiriliyor: %${state.percent ?? 0}`,
      ready: "Güncelleme hazır. Çalışan işlerinizi tamamlayıp yeniden başlatın.",
      installing: "Güncelleme yükleniyor…",
      error: "Güncelleme alınamadı. Bağlantıyı ve yayımlanmış sürümü kontrol edip tekrar deneyin.",
    };
    status.textContent = `Sürüm ${state.version} · ${messages[state.phase]}`;
    action.textContent =
      phase === "available"
        ? "İndir"
        : phase === "ready"
          ? "Yeniden başlat ve yükle"
          : "Güncellemeleri denetle";
    action.disabled = ["unsupported", "checking", "downloading", "installing"].includes(phase);
  }
  window.jarvis.onEvent((event) => {
    if (event.type === "update") render(event.update);
  });
  el("#updates-open").addEventListener("click", () => {
    dialog.showModal();
    void window.jarvis.updates.status().then(render);
  });
  action.addEventListener("click", async () => {
    action.disabled = true;
    try {
      if (phase === "ready") await window.jarvis.updates.install();
      else render(await window.jarvis.updates[phase === "available" ? "download" : "check"]());
    } catch {
      render({ phase: "error", version: "?" });
    }
  });
}
