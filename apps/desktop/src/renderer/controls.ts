import type { PermissionMode, PermissionView, Preset } from "../shared";
import { el } from "./ui";

// Settings tabs plus the permission, learning and memory panels. Everything goes through the
// bounded bridge; Core checks every change again and audits it.

const GROUPS: [string, (id: string) => boolean][] = [
  ["Uygulamalar ve pencereler", (id) => /^(app|window|screen|media)\./.test(id)],
  ["Ekran ve klavye", (id) => /^(ui|key)\./.test(id)],
  ["Pano", (id) => id.startsWith("clipboard.")],
  ["Dosyalar", (id) => id.startsWith("file.")],
  ["Web ve bilgi", (id) => /^(web|news)\./.test(id)],
  ["Hafıza", (id) => id.startsWith("memory.")],
  ["Entegrasyonlar", () => true],
];
const MODES: [PermissionMode, string][] = [
  ["ask", "Sor"],
  ["allow", "İzin ver"],
  ["deny", "Engelle"],
];
const RISK: Record<string, string> = {
  LOW: "Düşük risk",
  MEDIUM: "Orta risk",
  HIGH: "Yüksek risk",
};
const PRESET_NOTES: Record<Preset | "custom", string> = {
  guarded: "Güvenli: okuma ve açma işlemleri kendiliğinden, değiştiren her şey onayınızla.",
  trusted: "Dengeli: yüksek riskli entegrasyonlar dışında her şey sesli komutla çalışır.",
  autonomous: "Tam yetki: izinli her işlem, entegrasyonlar dahil, onay kartı olmadan çalışır.",
  custom: "Özel: işlemleri tek tek ayarladınız.",
};

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
const time = (at: number) =>
  new Date(at).toLocaleString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
const percent = (value: number | null) => (value === null ? "—" : `%${Math.round(value * 100)}`);

export function controls(status: (text: string) => void) {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [role="tab"]')];
  const list = el("[data-permission-list]");
  const presets = [...document.querySelectorAll<HTMLInputElement>('input[name="preset"]')];
  const presetNote = el("[data-preset-note]");
  const duration = el<HTMLSelectElement>("#grant-duration");
  const learning = el<HTMLInputElement>("#learning-toggle");
  const reflexes = el<HTMLInputElement>("#reflex-toggle");
  const brainStats = el("[data-brain-stats]");
  const skills = el("[data-skill-list]");
  const notes = el("[data-memory-list]");
  const brainConfirm = el("[data-brain-confirm]");

  function select(tab: HTMLButtonElement) {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(other.getAttribute("aria-controls") ?? "");
      if (panel) panel.hidden = !selected;
    }
    if (tab.id === "tab-permissions") void loadPermissions();
    if (tab.id === "tab-learning") void loadBrain();
    if (tab.id === "tab-memory") void loadMemories();
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      if (next) {
        select(next);
        next.focus();
      }
    });
  }

  async function guarded(run: () => Promise<void>, done?: string) {
    try {
      await run();
      if (done) status(done);
    } catch {
      status("Core'a ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.");
    }
  }

  function renderPermissions(view: PermissionView) {
    for (const input of presets) input.checked = input.value === view.preset;
    presetNote.textContent = PRESET_NOTES[view.preset];
    learning.checked = view.settings.learning;
    reflexes.checked = view.settings.reflexes;
    const remaining = [...view.actions];
    const sections = GROUPS.flatMap(([title, matches]) => {
      const members = remaining.filter((action) => matches(action.id));
      for (const member of members) remaining.splice(remaining.indexOf(member), 1);
      if (!members.length) return [];
      const section = node("section", "", "permission-group");
      section.append(node("h4", title));
      for (const action of members) {
        const row = node("div", "", "permission-row");
        row.dataset.action = action.id;
        row.dataset.available = String(action.available);
        const label = node("div", "", "permission-label");
        label.append(node("span", action.description.tr, "permission-name"));
        const meta = node("span", RISK[action.risk] ?? action.risk, "permission-meta");
        meta.dataset.risk = action.risk;
        if (!action.available) meta.textContent += " · Yapılandırılmadı";
        if (action.expiresAt) meta.textContent += ` · ${time(action.expiresAt)}'a kadar`;
        label.append(meta);
        const group = node("fieldset", "", "segmented small");
        group.append(node("legend", action.description.tr, "sr-only"));
        for (const [mode, text] of MODES) {
          const choice = node("label");
          const input = node("input");
          input.type = "radio";
          input.name = `mode-${action.id}`;
          input.value = mode;
          input.checked = action.mode === mode;
          choice.dataset.mode = mode;
          choice.append(input, node("span", text));
          input.addEventListener("change", () => {
            if (!input.checked || action.mode === mode) return;
            const expiresInMs =
              mode === "allow" && duration.value ? Number(duration.value) : undefined;
            void guarded(
              async () => {
                renderPermissions(
                  await window.jarvis.permissions.set({
                    actions: { [action.id]: { mode, ...(expiresInMs && { expiresInMs }) } },
                  }),
                );
              },
              `${action.description.tr}: ${text.toLocaleLowerCase("tr")}.`,
            );
          });
          group.append(choice);
        }
        row.append(label, group);
        section.append(row);
      }
      return [section];
    });
    list.replaceChildren(...sections);
  }

  async function loadPermissions() {
    await guarded(async () => renderPermissions(await window.jarvis.permissions.get()));
  }

  for (const input of presets)
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const preset = input.value as Preset;
      void guarded(
        async () => {
          renderPermissions(
            await window.jarvis.permissions.preset(
              preset,
              duration.value ? Number(duration.value) : undefined,
            ),
          );
        },
        `${input.parentElement?.textContent ?? ""} düzeyi uygulandı.`,
      );
    });

  for (const [toggle, key] of [
    [learning, "learning"],
    [reflexes, "reflexes"],
  ] as const)
    toggle.addEventListener("change", () => {
      void guarded(
        async () => {
          const view = await window.jarvis.permissions.set({ settings: { [key]: toggle.checked } });
          learning.checked = view.settings.learning;
          reflexes.checked = view.settings.reflexes;
        },
        toggle.checked ? "Açıldı." : "Kapatıldı.",
      );
    });

  async function loadBrain() {
    await guarded(async () => {
      const [view, permissions] = await Promise.all([
        window.jarvis.brain.get(),
        window.jarvis.permissions.get(),
      ]);
      learning.checked = permissions.settings.learning;
      reflexes.checked = permissions.settings.reflexes;
      const { stats } = view;
      brainStats.textContent = `${stats.experiences} deneyim · ${stats.skills} beceri · ${stats.preferences} öğrenilmiş seçim · başarı ${percent(stats.planSuccessRate)} · düzeltme ${percent(stats.correctionRate)}`;
      skills.replaceChildren(
        ...(view.skills.length
          ? view.skills.map((skill) => {
              const item = node("li", "", "item");
              item.dataset.skill = skill.id;
              const text = node("div", "", "item-text");
              text.append(
                node(
                  "span",
                  skill.goal || skill.phrases[0] || skill.steps.join(", "),
                  "item-title",
                ),
                node(
                  "span",
                  `“${skill.phrases[0] ?? ""}” · güç %${Math.round(skill.strength * 100)} · ${skill.successes} başarı`,
                  "item-meta",
                ),
              );
              const forget = node("button", "Unut", "btn text danger");
              forget.type = "button";
              forget.setAttribute("aria-label", `${skill.goal} becerisini unut`);
              forget.addEventListener("click", () => {
                void guarded(async () => {
                  await window.jarvis.brain.forgetSkill(skill.id);
                  await loadBrain();
                }, "Beceri unutuldu.");
              });
              item.append(text, forget);
              return item;
            })
          : [node("li", "Henüz öğrenilmiş bir beceri yok.", "item empty")]),
      );
    });
  }
  el("#brain-sleep").addEventListener("click", () => {
    void guarded(async () => {
      await window.jarvis.brain.consolidate();
      await loadBrain();
    }, "Öğrenilenler pekiştirildi.");
  });
  el("#brain-reset").addEventListener("click", () => {
    brainConfirm.hidden = false;
  });
  el("#brain-keep").addEventListener("click", () => {
    brainConfirm.hidden = true;
  });
  el("#brain-confirm").addEventListener("click", () => {
    void guarded(async () => {
      await window.jarvis.brain.reset();
      brainConfirm.hidden = true;
      await loadBrain();
    }, "Öğrenilenler sıfırlandı.");
  });

  async function loadMemories() {
    await guarded(async () => {
      const memories = await window.jarvis.memories.get();
      notes.replaceChildren(
        ...(memories.length
          ? memories.map((memory) => {
              const item = node("li", "", "item");
              item.dataset.memory = memory.id;
              const text = node("div", "", "item-text");
              text.append(
                node("span", memory.note, "item-title"),
                node("span", time(memory.createdAt), "item-meta"),
              );
              const forget = node("button", "Unut", "btn text danger");
              forget.type = "button";
              forget.setAttribute("aria-label", `“${memory.note}” notunu unut`);
              forget.addEventListener("click", () => {
                void guarded(async () => {
                  await window.jarvis.memories.forget(memory.id);
                  await loadMemories();
                }, "Not unutuldu.");
              });
              item.append(text, forget);
              return item;
            })
          : [node("li", "Henüz hatırladığım bir not yok.", "item empty")]),
      );
    });
  }
  el("#memory-clear").addEventListener("click", () => {
    void guarded(async () => {
      await window.jarvis.memories.clear();
      await loadMemories();
    }, "Tüm notlar unutuldu.");
  });

  return {
    // The sheet opens on the first tab; the others load when chosen.
    reset() {
      const [first] = tabs;
      if (first) select(first);
      brainConfirm.hidden = true;
    },
  };
}
