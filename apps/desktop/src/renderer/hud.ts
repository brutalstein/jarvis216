import type { PlanView } from "../shared";

const states: Record<string, string> = {
  AWAITING_APPROVAL: "Onayınızı bekliyorum",
  RUNNING: "İşlem sürüyor",
  COMPLETED: "Tamamlandı",
  SKIPPED: "Koşul sağlanmadığı için atlandı",
  FAILED: "Tamamlanamadı",
  CANCELLED: "İptal edildi",
  RECOVERY_REQUIRED: "Sonuç doğrulanamadı",
  WAITING_FOR_APPROVAL: "Onay bekliyor",
  PENDING: "Sırada",
  QUEUED: "Sırada",
  READY: "Hazır",
  SUCCEEDED: "Tamamlandı",
  VERIFIED: "Tamamlandı",
  BLOCKED: "Durduruldu",
};
type Progress = NonNullable<PlanView["progress"]>;
const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));
// "bbc.com okunuyor · 2/3 · 12 sn · ~8 sn kaldı": what Core reported, with local time.
export function liveText(progress: Progress, now: number): string {
  const position =
    progress.total !== undefined && progress.total > 1 && progress.index !== undefined
      ? ` · ${progress.index}/${progress.total}`
      : "";
  const what = progress.finishing
    ? "Sonuçları derliyorum"
    : progress.detail && progress.stage === "opening"
      ? `${progress.detail} açılıyor${position}`
      : progress.detail && progress.stage === "read"
        ? `${progress.detail} okundu${position}`
        : progress.detail
          ? `${progress.detail} okunuyor${position}`
          : `${progress.step}/${progress.steps}. adım · ${progress.action}`;
  const left =
    progress.etaAt === undefined
      ? ""
      : progress.etaAt > now
        ? ` · ~${seconds(progress.etaAt - now)} sn kaldı`
        : " · beklenenden uzun sürüyor";
  return `${what} · ${seconds(now - progress.startedAt)} sn${left}`;
}
const share = (progress: Progress, now: number) =>
  progress.etaAt === undefined || progress.etaAt <= progress.startedAt
    ? undefined
    : Math.min(
        95,
        Math.round(((now - progress.startedAt) / (progress.etaAt - progress.startedAt)) * 100),
      );

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

export function hud(root: HTMLElement, compact = false) {
  const stage = node("div", "", "hud");
  root.prepend(stage);
  const indicator = node("p", "Masaüstü kontrolü JARVIS’te", "control-indicator");
  indicator.dataset.control = "";
  indicator.setAttribute("role", "status");
  indicator.hidden = true;
  root.before(indicator);
  const plans = new Map<string, PlanView>();
  const busy = new Set<string>();

  function button(
    label: string,
    run: () => Promise<unknown>,
    card: HTMLElement,
    id: string,
    primary = false,
  ) {
    const control = node("button", label, `btn ${primary ? "primary" : "outline"}`);
    control.type = "button";
    control.disabled = busy.has(id);
    control.addEventListener("click", async () => {
      if (busy.has(id)) return;
      busy.add(id);
      for (const item of card.querySelectorAll("button")) item.disabled = true;
      try {
        await run();
      } catch {
        const error = node("p", "İşlem gönderilemedi. Yeniden deneyin.", "hud-error");
        error.setAttribute("role", "alert");
        card.querySelector(".hud-error")?.remove();
        card.append(error);
      } finally {
        busy.delete(id);
        for (const item of card.querySelectorAll("button")) item.disabled = false;
      }
    });
    return control;
  }

  function render(plan: PlanView) {
    const card = node("article", "", "card plan-card");
    card.dataset.hudCard = plan.id;
    card.dataset.planStatus = plan.status;
    card.append(
      node("p", states[plan.status] ?? plan.status, "plan-status"),
      node("h2", plan.goal),
    );
    const progress = plan.status === "RUNNING" ? plan.progress : undefined;
    if (progress) {
      const live = node("p", liveText(progress, Date.now()), "plan-live");
      live.dataset.live = plan.id;
      live.setAttribute("role", "status");
      card.append(live);
      const value = share(progress, Date.now());
      if (value !== undefined) {
        const meter = node("div", "", "plan-meter");
        meter.dataset.meter = plan.id;
        meter.setAttribute("role", "progressbar");
        meter.setAttribute("aria-label", "Tahmini ilerleme");
        meter.setAttribute("aria-valuemin", "0");
        meter.setAttribute("aria-valuemax", "100");
        meter.setAttribute("aria-valuenow", String(value));
        const fill = node("span", "", "plan-meter-fill");
        fill.style.width = `${value}%`;
        meter.append(fill);
        card.append(meter);
      }
    }
    const steps = node("ol", "", "progress-rail");
    for (const step of plan.steps) {
      const row = node("li");
      row.dataset.step = step.status;
      row.append(node("span", step.action, "step-action"));
      // The badge states the rule that applies now: the operator's Settings decide.
      const granted = step.mode === "allow" && step.risk !== "LOW";
      const risk = node(
        "span",
        granted
          ? "Ayarlardan izinli"
          : step.mode === "ask" && step.risk === "LOW"
            ? "Onay gerekir"
            : step.risk === "HIGH"
              ? "Ayrı onay gerekir"
              : step.risk === "MEDIUM"
                ? "Onay gerekir"
                : "Otomatik",
        "risk",
      );
      risk.dataset.risk = granted ? "LOW" : step.mode === "ask" ? "MEDIUM" : step.risk;
      const status = node("span", states[step.status] ?? step.status, "step-status");
      status.dataset.stepStatus = "";
      row.append(risk, status);
      const approval = step.approval;
      if (plan.status === "RUNNING" && step.risk === "HIGH" && approval)
        row.append(
          button(
            `${approval.target} işlemini onayla`,
            () => window.jarvis.plans.approveAction(approval.id),
            card,
            plan.id,
          ),
        );
      if (Object.keys(step.args).length)
        row.append(node("pre", JSON.stringify(step.args, null, 2), "step-args"));
      steps.append(row);
    }
    card.append(steps);
    const actions = node("div", "", "actions");
    if (plan.status === "AWAITING_APPROVAL") {
      const approve = button(
        "Onayla",
        () => window.jarvis.plans.approve(plan.id, plan.hash),
        card,
        plan.id,
        true,
      );
      approve.dataset.approve = "";
      const reject = button("Reddet", () => window.jarvis.plans.reject(plan.id), card, plan.id);
      reject.dataset.reject = "";
      actions.append(approve, reject);
      card.append(node("p", "Enter · Onayla    Esc · Reddet", "plan-keys"));
    } else if (plan.status === "RUNNING") {
      actions.append(button("Durdur", () => window.jarvis.plans.cancel(plan.id), card, plan.id));
    }
    if (actions.childElementCount) card.append(actions);
    for (const panel of plan.panels) {
      if (panel.type === "candidates") {
        const choices = node("div", "", "candidate-list");
        choices.append(node("h3", "Hangi pencere?"));
        panel.items.forEach((item, index) => {
          choices.append(
            button(
              `${index + 1}. ${item}`,
              async () => {
                const next = await window.jarvis.plans.choose(panel.planId, index + 1);
                if (next) update(next);
              },
              card,
              plan.id,
            ),
          );
        });
        card.append(choices);
      } else if (panel.type === "windows") {
        const list = node("ul", "", "window-list");
        for (const item of panel.items) list.append(node("li", item));
        card.append(node("h3", "Pencereler"), list);
      } else if (panel.type === "news") {
        card.append(node("h3", panel.title));
        const list = node("div", "", "news-grid");
        for (const item of panel.items) {
          const news = button("", () => window.jarvis.plans.open(item.url), card, plan.id);
          news.className = "news-item";
          news.dataset.news = "";
          const text = node("span", "", "news-text");
          text.append(
            node("span", item.headline, "news-headline"),
            node("span", item.source, "news-source"),
          );
          news.append(text);
          if (
            item.image &&
            /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.image) &&
            item.image.length <= 280000
          ) {
            const image = document.createElement("img");
            image.src = item.image;
            image.alt = "";
            news.prepend(image);
          }
          list.append(news);
        }
        card.append(list);
      } else if (panel.type === "text") {
        card.append(node("h3", panel.title), node("pre", panel.body, "text-panel"));
      }
    }
    return card;
  }

  function update(plan: PlanView) {
    plans.delete(plan.id);
    plans.set(plan.id, plan);
    if (plans.size > 5) {
      const old =
        [...plans.values()].find(
          (item) => !["RUNNING", "AWAITING_APPROVAL"].includes(item.status),
        ) ??
        [...plans.values()].find((item) => item.kind === "info") ??
        plans.values().next().value;
      if (old) plans.delete(old.id);
    }
    indicator.hidden = ![...plans.values()].some(
      (item) => item.kind === "desktop" && item.status === "RUNNING",
    );
    const latest = [...plans.values()].reverse();
    stage.replaceChildren(...(compact ? latest.slice(0, 1) : latest).map(render));
  }
  // Time spent and left move every second between Core's updates; only the live line changes.
  setInterval(() => {
    const now = Date.now();
    for (const live of stage.querySelectorAll<HTMLElement>("[data-live]")) {
      const progress = plans.get(live.dataset.live ?? "")?.progress;
      if (progress) live.textContent = liveText(progress, now);
    }
    for (const meter of stage.querySelectorAll<HTMLElement>("[data-meter]")) {
      const progress = plans.get(meter.dataset.meter ?? "")?.progress;
      const value = progress && share(progress, now);
      const fill = meter.firstElementChild as HTMLElement | null;
      if (value === undefined || !fill) continue;
      meter.setAttribute("aria-valuenow", String(value));
      fill.style.width = `${value}%`;
    }
  }, 1000);
  if (!compact)
    document.addEventListener("keydown", (event) => {
      if (
        event.repeat ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        document.querySelector("dialog[open]") ||
        (event.target instanceof Element &&
          event.target.closest("input,select,textarea,button,a,[contenteditable=true]"))
      )
        return;
      const card = stage.querySelector("[data-plan-status=AWAITING_APPROVAL]");
      const selector =
        event.key === "Enter" ? "[data-approve]" : event.key === "Escape" ? "[data-reject]" : "";
      if (card && selector) {
        event.preventDefault();
        card.querySelector<HTMLButtonElement>(selector)?.click();
      }
    });
  return update;
}
