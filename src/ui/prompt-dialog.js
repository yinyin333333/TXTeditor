import { tText } from "../core/i18n.js";

export function askText({ title, message, defaultValue = "", inputMode = "text", validate = (value) => ({ value }), escapeHtml, host }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <input class="modal-input" inputmode="${escapeHtml(inputMode)}" value="${escapeHtml(defaultValue)}" />
      <div class="modal-error" role="alert"></div>
      <div class="modal-actions">
        <button data-prompt-choice="ok">${tText("common.ok")}</button>
        <button data-prompt-choice="cancel">${tText("common.cancel")}</button>
      </div>
    </div>`;
  document.body.append(backdrop);
  const input = backdrop.querySelector("input");
  const error = backdrop.querySelector(".modal-error");
  input.focus();
  input.select();
  return new Promise((resolve) => {
    const finish = (value) => {
      backdrop.remove();
      host.focus();
      resolve(value);
    };
    const submit = () => {
      const result = validate(input.value);
      if (result?.error) {
        error.textContent = result.error;
        input.focus();
        input.select();
        return;
      }
      finish(result?.value ?? input.value);
    };
    backdrop.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-prompt-choice]")?.dataset.promptChoice;
      if (choice === "ok") submit();
      if (choice === "cancel") finish(null);
    });
    input.addEventListener("input", () => {
      error.textContent = "";
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });
  });
}

export function promptNumber({ title, message, defaultValue = "", min = null, max = null, allowFloat = false, askText }) {
  return askText({
    title,
    message,
    defaultValue: String(defaultValue),
    inputMode: "decimal",
    validate(value) {
      const text = value.trim();
      const number = allowFloat ? Number(text) : Number.parseInt(text, 10);
      if (text === "" || !Number.isFinite(number)) return { error: tText("prompt.validNumber") };
      if (!allowFloat && String(number) !== text) return { error: tText("prompt.wholeNumber") };
      if (min !== null && number < min) return { error: tText("prompt.numberAtLeast", { min }) };
      if (max !== null && number > max) return { error: tText("prompt.numberAtMost", { max }) };
      return { value: number };
    }
  });
}
