import { element } from "./dom";

export function settings(changeMic: (id: string) => Promise<void> | void) {
  const dialog = document.querySelector("dialog");
  const status = document.querySelector<HTMLElement>("[data-settings-status]");
  const note = document.querySelector<HTMLElement>("[data-enrollment-note]");
  if (!dialog || !status || !note) return;
  const button = (id: string, action: () => Promise<void>) => {
    const element = document.getElementById(id) as HTMLButtonElement;
    element.onclick = async () => {
      element.disabled = true;
      status.textContent = "";
      try {
        await action();
      } catch (error) {
        status.textContent = String(error).includes("MORE_SPEECH_NEEDED")
          ? "Biraz daha konuşun; en az 25 saniye ses gerekiyor."
          : "Bağlantı kurulamadı. Tekrar deneyin.";
      } finally {
        element.disabled = false;
      }
    };
  };
  document.getElementById("settings-open")?.addEventListener("click", async () => {
    dialog.showModal();
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const select = document.getElementById("microphone") as HTMLSelectElement;
      select.replaceChildren(new Option("Varsayılan mikrofon", ""));
      for (const device of devices.filter((d) => d.kind === "audioinput"))
        select.add(new Option(device.label || "Mikrofon", device.deviceId));
    } catch {
      status.textContent = "Mikrofon listesi alınamadı.";
    }
  });
  document.getElementById("microphone")?.addEventListener("change", async (event) => {
    try {
      await changeMic((event.target as HTMLSelectElement).value);
    } catch {
      status.textContent = "Mikrofon değiştirilemedi. Aygıt bağlantısını kontrol edin.";
    }
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let seconds = 0;
  const phrases = [
    "Jarvis, bugün sesimi tanımanı istiyorum. Doğal bir şekilde konuşuyorum; acelem yok.",
    "Gün içinde birlikte plan yapabilir, fikirleri konuşabilir ve soruları inceleyebiliriz.",
    "Jarvis, this is my natural voice. I can speak both Turkish and English with you.",
  ];
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  button("enroll-start", async () => {
    await window.jarvis.enrollment.start();
    stop();
    seconds = 0;
    (document.querySelector("[data-enrollment]") as HTMLElement).hidden = false;
    (document.getElementById("enroll-finish") as HTMLElement).hidden = false;
    note.textContent = "Yaklaşık 30 saniye, doğal sesinizle konuşun.";
    const phrase = element("[data-enrollment-phrase]");
    const progress = element<HTMLProgressElement>("progress");
    phrase.textContent = phrases[0];
    progress.value = 0;
    timer = setInterval(() => {
      seconds++;
      progress.value = Math.min(30, seconds);
      phrase.textContent = phrases[Math.min(2, Math.floor(seconds / 10))];
      if (seconds >= 40) stop();
    }, 1000);
  });
  button("enroll-finish", async () => {
    await window.jarvis.enrollment.finish();
    stop();
    (document.querySelector("[data-enrollment]") as HTMLElement).hidden = true;
    (document.getElementById("enroll-finish") as HTMLElement).hidden = true;
    note.textContent = "Sesiniz tanındı. Ses izi yalnızca bu bilgisayarda tutuluyor.";
  });
  button("enroll-remove", async () => {
    await window.jarvis.enrollment.remove();
    stop();
    note.textContent = "Ses izi silindi. JARVIS yalnızca adıyla seslenildiğinde yanıt verir.";
  });
  button("turns-export", async () => {
    const turns = await window.jarvis.turns.export();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(turns, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "jarvis-konusmalar.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Konuşmalar dışa aktarıldı.";
  });
  button("turns-delete", async () => {
    (document.querySelector("[data-confirm-delete]") as HTMLElement).hidden = false;
  });
  button("turns-confirm", async () => {
    await window.jarvis.turns.deleteAll();
    (document.querySelector("[data-confirm-delete]") as HTMLElement).hidden = true;
    status.textContent = "Konuşmalar silindi.";
  });
}
