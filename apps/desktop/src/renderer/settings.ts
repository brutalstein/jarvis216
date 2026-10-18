import { el } from "./ui";

// Read aloud during enrollment; the print is taken from whatever the operator says.
const PHRASES = [
  "Jarvis, bugün sesimi tanımanı istiyorum. Acelem yok, doğal konuşuyorum.",
  "Gün içinde birlikte plan yapar, fikirleri konuşur, soruları inceleriz.",
  "Jarvis, this is my normal voice. I speak both Turkish and English with you.",
  "Yarın hava nasıl olacak, akşam bir toplantım var mı, kısaca anlat.",
];

const NOTES = {
  none: "JARVIS şimdilik yalnızca adını duyduğunda yanıt verir. Sesinizi tanırsa diğer konuşmaları ayırır.",
  enrolled: "Sesiniz tanındı. Ses izi yalnızca bu bilgisayarda tutulur.",
  recording: "Cümleleri doğal sesinizle okuyun. Konuştukça çizgi ilerler.",
};
type Mode = keyof typeof NOTES;

function message(error: unknown) {
  return String(error).includes("MORE_SPEECH_NEEDED")
    ? "Biraz daha konuşun; en az 25 saniye ses gerekiyor."
    : "Ses servisine ulaşılamadı. Tekrar deneyin.";
}

export function settings(options: { changeMic(id: string): Promise<void>; listen(): void }) {
  const sheet = el<HTMLDialogElement>("dialog.sheet");
  const status = el("[data-settings-status]");
  const voice = el("[data-enroll]");
  const note = el("[data-enroll-note]");
  const recording = el("[data-recording]");
  const phrase = el("[data-phrase]");
  const meter = el("[data-meter]");
  const meterValue = el("[data-meter-value]");
  const microphone = el<HTMLSelectElement>("#microphone");
  const confirm = el("[data-confirm]");
  const voiceConfirm = el("[data-voice-confirm]");
  const start = el<HTMLButtonElement>("#enroll-start");
  const finish = el<HTMLButtonElement>("#enroll-finish");
  const cancel = el<HTMLButtonElement>("#enroll-cancel");
  const remove = el<HTMLButtonElement>("#enroll-remove");
  let poll: ReturnType<typeof setInterval> | undefined;
  let seconds = 0;
  let chosenMic = "";

  function view(mode: Mode) {
    voice.dataset.enroll = mode;
    note.textContent = NOTES[mode];
    recording.hidden = mode !== "recording";
    start.hidden = mode === "recording";
    start.textContent = mode === "enrolled" ? "Yeniden tanıt" : "Sesimi tanıt";
    start.className = mode === "enrolled" ? "btn outline" : "btn primary";
    finish.hidden = mode !== "recording";
    cancel.hidden = mode !== "recording";
    remove.hidden = mode !== "enrolled";
    voiceConfirm.hidden = true;
  }

  function progress(value: number) {
    seconds = value;
    meter.style.setProperty("--progress", String(Math.min(1, value / 30)));
    meterValue.textContent = `${Math.floor(Math.min(value, 30))} / 30 sn`;
    phrase.textContent = PHRASES[Math.floor(value / 8) % PHRASES.length];
    finish.disabled = value < 25;
  }

  function stopPolling() {
    clearInterval(poll);
    poll = undefined;
  }

  async function refresh() {
    if (voice.dataset.enroll === "recording") return;
    try {
      view((await window.jarvis.enrollment.status()).enrolled ? "enrolled" : "none");
    } catch {
      view("none");
    }
  }

  async function listMicrophones() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      microphone.replaceChildren(new Option("Varsayılan mikrofon", ""));
      for (const device of devices.filter((d) => d.kind === "audioinput" && d.deviceId))
        if (device.deviceId !== "default")
          microphone.add(new Option(device.label || "Mikrofon", device.deviceId));
      microphone.value = chosenMic;
    } catch {
      status.textContent = "Mikrofon listesi alınamadı.";
    }
  }

  function action(button: HTMLButtonElement, run: () => Promise<void>) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "";
      try {
        await run();
      } catch (error) {
        status.textContent = message(error);
      } finally {
        if (button === finish) progress(seconds);
        else button.disabled = false;
      }
    });
  }

  el("#settings-open").addEventListener("click", () => {
    status.textContent = "";
    sheet.showModal();
    void refresh();
    void listMicrophones();
  });
  // A click that lands on the dialog itself is a click on its backdrop.
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.close();
  });
  sheet.addEventListener("close", () => {
    confirm.hidden = true;
    voiceConfirm.hidden = true;
    if (voice.dataset.enroll !== "recording") return;
    // An abandoned enrollment must not leave the service collecting instead of listening.
    stopPolling();
    view("none");
    void window.jarvis.enrollment.cancel().catch(() => {});
  });

  microphone.addEventListener("change", async () => {
    try {
      await options.changeMic(microphone.value);
      chosenMic = microphone.value;
      status.textContent = "Mikrofon değiştirildi.";
    } catch {
      microphone.value = chosenMic;
      status.textContent = "Mikrofon değiştirilemedi. Aygıt bağlantısını kontrol edin.";
    }
  });

  action(start, async () => {
    await window.jarvis.enrollment.start();
    options.listen();
    view("recording");
    progress(0);
    stopPolling();
    poll = setInterval(async () => {
      try {
        progress((await window.jarvis.enrollment.status()).seconds);
      } catch {
        status.textContent = message(undefined);
      }
    }, 1000);
  });
  action(finish, async () => {
    await window.jarvis.enrollment.finish();
    stopPolling();
    view("enrolled");
    status.textContent = "Sesiniz kaydedildi.";
  });
  action(cancel, async () => {
    stopPolling();
    await window.jarvis.enrollment.cancel();
    view("none");
    await refresh();
  });
  remove.addEventListener("click", () => {
    voiceConfirm.hidden = false;
  });
  el("#voice-keep").addEventListener("click", () => {
    voiceConfirm.hidden = true;
  });
  action(el<HTMLButtonElement>("#voice-confirm"), async () => {
    await window.jarvis.enrollment.remove();
    view("none");
    status.textContent = "Ses izi silindi.";
  });

  action(el<HTMLButtonElement>("#turns-export"), async () => {
    const turns = await window.jarvis.turns.export();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(turns, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "jarvis-konusmalar.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Konuşmalar indirildi.";
  });
  el("#turns-delete").addEventListener("click", () => {
    confirm.hidden = false;
  });
  el("#turns-keep").addEventListener("click", () => {
    confirm.hidden = true;
  });
  action(el<HTMLButtonElement>("#turns-confirm"), async () => {
    await window.jarvis.turns.deleteAll();
    confirm.hidden = true;
    status.textContent = "Tüm konuşmalar silindi.";
  });

  view("none");
}
