/*! glk-touch — on-screen commands for GlkOte interactive fiction players.
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 */
"use strict";
(() => {
  // src/command-model.ts
  var MAX_COMMAND_LENGTH = 120;
  var DEFAULT_VERBS = [
    "look",
    "inventory",
    "examine",
    "take",
    "drop",
    "open",
    "close",
    "in",
    "out",
    "read",
    "search",
    "push",
    "pull",
    "turn on",
    "turn off",
    "unlock",
    "wear",
    "enter",
    "wait",
    "again",
    "undo",
    "save",
    "restore"
  ];
  var MAX_VERBS = 40;
  var MAX_VERB_LENGTH = 30;
  function str(v) {
    return v === null || v === void 0 ? "" : String(v);
  }
  function normalizeWord(word) {
    let s = str(word).trim().toLowerCase();
    if (!s) {
      return "";
    }
    s = s.replace(/\s+/g, " ");
    s = s.replace(/['’]s\b/g, "");
    s = s.replace(/[^\p{L}\p{N} -]/gu, "");
    s = s.replace(/^[\s-]+|[\s-]+$/g, "");
    return s;
  }
  function normalizeVerb(verb) {
    let s = str(verb).trim().toLowerCase();
    if (!s) {
      return "";
    }
    s = s.replace(/\s+/g, " ");
    const slash = s.startsWith("/") ? "/" : "";
    s = s.slice(slash.length);
    s = s.replace(/[^\p{L}\p{N} -]/gu, "");
    s = s.replace(/^[\s-]+|[\s-]+$/g, "");
    return s === "" ? "" : slash + s;
  }
  function tokenize(text) {
    const s = str(text);
    if (s === "") {
      return [];
    }
    const tokens = [];
    const re = /\p{L}[\p{L}\p{N}]*(?:-[\p{L}\p{N}]+)*/gu;
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) {
        tokens.push({ text: s.slice(last, m.index), isWord: false });
      }
      tokens.push({ text: m[0], isWord: true });
      last = m.index + m[0].length;
    }
    if (last < s.length) {
      tokens.push({ text: s.slice(last), isWord: false });
    }
    return tokens;
  }
  function createState() {
    return { pendingVerb: null, pendingNoun: null };
  }
  function clearPending(_state) {
    return createState();
  }
  function result(state2, command) {
    if (command !== null && command.length > MAX_COMMAND_LENGTH) {
      return { state: createState(), command: null };
    }
    return { state: state2, command };
  }
  function tapVerb(state2, verb) {
    const v = normalizeVerb(verb);
    if (!v) {
      return result(state2, null);
    }
    if (state2.pendingNoun) {
      return result(createState(), v + " " + state2.pendingNoun);
    }
    return result({ pendingVerb: v, pendingNoun: null }, null);
  }
  function tapWord(state2, word) {
    const n = normalizeWord(word);
    if (!n) {
      return result(state2, null);
    }
    if (state2.pendingVerb) {
      return result(createState(), state2.pendingVerb + " " + n);
    }
    return result({ pendingVerb: null, pendingNoun: n }, null);
  }
  function tapDirect(_state, command) {
    const c = str(command).trim();
    if (!c) {
      return result(createState(), null);
    }
    return result(createState(), c.replace(/\s+/g, " "));
  }
  function addVerb(list, verb) {
    const v = normalizeVerb(verb);
    const out = list.slice();
    if (!v || v.length > MAX_VERB_LENGTH || out.length >= MAX_VERBS) {
      return out;
    }
    if (out.indexOf(v) !== -1) {
      return out;
    }
    out.push(v);
    return out;
  }
  function removeVerb(list, verb) {
    const v = normalizeVerb(verb);
    return list.filter((x) => x !== v);
  }
  function moveVerb(list, verb, toIndex) {
    const v = normalizeVerb(verb);
    const out = list.slice();
    const from = out.indexOf(v);
    if (from === -1) {
      return out;
    }
    if (!Number.isFinite(toIndex)) {
      return out;
    }
    const to = Math.max(0, Math.min(out.length - 1, Math.trunc(toIndex)));
    if (to === from) {
      return out;
    }
    out.splice(from, 1);
    out.splice(to, 0, v);
    return out;
  }

  // src/if-buttons.ts
  var VERBS_KEY = "IFB_Verbs";
  var MOVES = [
    ["NW", "northwest"],
    ["N", "north"],
    ["NE", "northeast"],
    ["W", "west"],
    ["E", "east"],
    ["SW", "southwest"],
    ["S", "south"],
    ["SE", "southeast"],
    ["Up", "up"],
    ["Down", "down"]
  ];
  var MAP_SELECTORS = "#map, #map-container, .map-container, [data-if-map]";
  var MIN_LIFTED_HEIGHT = 24;
  var MIN_DRAG_PX = 6;
  var state = createState();
  var bootTimer = null;
  var barSizeObserver = null;
  var barResizeBound = false;
  var selectedVerb = null;
  function bufferWindow() {
    return document.querySelector(".BufferWindow");
  }
  function findLineInput() {
    var _a;
    let inputs = document.querySelectorAll("input.Input.LineInput, .Input.LineInput");
    if (inputs.length === 0) {
      inputs = document.querySelectorAll("input.Input, .Input");
    }
    return inputs.length === 0 ? null : (_a = inputs[inputs.length - 1]) != null ? _a : null;
  }
  function isVisible(el) {
    if (!el) {
      return false;
    }
    if (!(el instanceof HTMLElement)) {
      return true;
    }
    if (el.hidden) {
      return false;
    }
    if (el.style.display === "none") {
      return false;
    }
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") {
      return false;
    }
    return true;
  }
  function morePrompt() {
    const el = document.querySelector(".MorePrompt");
    return isVisible(el) ? el : null;
  }
  function inputMode() {
    if (morePrompt()) {
      return "more";
    }
    if (findLineInput()) {
      return "line";
    }
    return "char";
  }
  function fireKey(el, key, keyCode) {
    const e = new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key, code: key });
    try {
      Object.defineProperty(e, "keyCode", { get: () => keyCode });
      Object.defineProperty(e, "which", { get: () => keyCode });
      Object.defineProperty(e, "charCode", { get: () => keyCode });
    } catch (e2) {
    }
    el.dispatchEvent(e);
  }
  function dismissMorePrompt() {
    const more = morePrompt();
    if (!more) {
      return false;
    }
    more.click();
    const bw = bufferWindow();
    if (bw) {
      fireKey(bw, " ", 32);
    }
    return true;
  }
  function submitCommand(command) {
    const cmd = (command != null ? command : "").trim();
    if (!cmd) {
      return false;
    }
    const mode = inputMode();
    if (mode === "more") {
      dismissMorePrompt();
      return false;
    }
    if (mode === "char") {
      const bw = bufferWindow();
      if (bw) {
        fireKey(bw, " ", 32);
      }
      return false;
    }
    const el = findLineInput();
    if (!el) {
      return false;
    }
    el.focus();
    el.value = cmd;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    fireKey(el, "Enter", 13);
    return true;
  }
  function pressEnter() {
    const mode = inputMode();
    if (mode === "more") {
      dismissMorePrompt();
      return false;
    }
    if (mode === "char") {
      const bw = bufferWindow();
      if (bw) {
        fireKey(bw, "Enter", 13);
      }
      return false;
    }
    const el = findLineInput();
    if (!el) {
      return false;
    }
    el.focus();
    fireKey(el, "Enter", 13);
    return true;
  }
  function stageCommand(text) {
    const el = findLineInput();
    if (!el) {
      return false;
    }
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  function cancelPending() {
    state = clearPending(state);
    renderArmed(null);
    stageCommand("");
  }
  function tapDirection(direction) {
    if (state.pendingVerb !== null) {
      apply(tapWord(state, direction), null, "send");
      return;
    }
    apply(tapDirect(state, direction), null, "send");
  }
  function apply(res, armEl, delivery) {
    var _a, _b;
    state = res.state;
    renderArmed(armEl);
    if (delivery === "send") {
      if (res.command) {
        submitCommand(res.command);
      }
      return;
    }
    const composed = (_b = (_a = res.command) != null ? _a : state.pendingVerb) != null ? _b : state.pendingNoun;
    if (composed !== null) {
      stageCommand(composed);
    }
  }
  function renderArmed(armEl) {
    for (const el of document.querySelectorAll(".ifb-armed")) {
      el.classList.remove("ifb-armed");
    }
    if (armEl && (state.pendingVerb || state.pendingNoun)) {
      armEl.classList.add("ifb-armed");
    }
  }
  function decorateBuffer(root) {
    var _a;
    if (!root) {
      return;
    }
    ensureWordClicks(root);
    const lines = root.classList.contains("BufferLine") ? [root] : [...root.querySelectorAll(".BufferLine")];
    for (const line of lines) {
      if (line.getAttribute("data-ifb-done") === "1") {
        continue;
      }
      line.setAttribute("data-ifb-done", "1");
      if (line.classList.contains("Style_input")) {
        continue;
      }
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }
      for (const node of textNodes) {
        if (isInsideSkipped(node, line)) {
          continue;
        }
        const tokens = tokenize(node.nodeValue);
        if (!tokens.some((t) => t.isWord)) {
          continue;
        }
        const frag = document.createDocumentFragment();
        for (const t of tokens) {
          if (t.isWord) {
            const span = document.createElement("span");
            span.className = "ifb-word";
            span.textContent = t.text;
            frag.appendChild(span);
          } else {
            frag.appendChild(document.createTextNode(t.text));
          }
        }
        (_a = node.parentNode) == null ? void 0 : _a.replaceChild(frag, node);
      }
    }
  }
  function isInsideSkipped(node, line) {
    let p = node.parentNode;
    while (p && p !== line) {
      if (p instanceof Element && (p.classList.contains("Style_input") || p.classList.contains("ifb-word"))) {
        return true;
      }
      p = p.parentNode;
    }
    return false;
  }
  function ensureWordClicks(near) {
    var _a;
    const bw = (_a = near == null ? void 0 : near.closest(".BufferWindow")) != null ? _a : bufferWindow();
    if (!bw) {
      return;
    }
    if (bw.getAttribute("data-ifb-clickable") === "1") {
      return;
    }
    bw.setAttribute("data-ifb-clickable", "1");
    bw.addEventListener("click", (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.classList.contains("ifb-word")) {
        apply(tapWord(state, t.textContent), t, "stage");
      }
    });
  }
  function watchBuffer() {
    const bw = bufferWindow();
    if (!bw) {
      return false;
    }
    decorateBuffer(bw);
    if (bw.getAttribute("data-ifb-observed") !== "1") {
      bw.setAttribute("data-ifb-observed", "1");
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            if (n instanceof Element) {
              decorateBuffer(n);
            }
          }
        }
      }).observe(bw, { childList: true, subtree: true });
    }
    ensureWordClicks(bw);
    return true;
  }
  function loadVerbs() {
    try {
      const raw = window.localStorage.getItem(VERBS_KEY);
      if (!raw) {
        return DEFAULT_VERBS.slice();
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return DEFAULT_VERBS.slice();
      }
      const clean = parsed.filter((v) => typeof v === "string" && normalizeVerb(v) !== "").map((v) => normalizeVerb(v));
      if (clean.length === 0 && parsed.length > 0) {
        return DEFAULT_VERBS.slice();
      }
      return clean;
    } catch (e) {
      return DEFAULT_VERBS.slice();
    }
  }
  function saveVerbs(list) {
    try {
      window.localStorage.setItem(VERBS_KEY, JSON.stringify(list));
    } catch (e) {
    }
  }
  function resetVerbs() {
    try {
      window.localStorage.removeItem(VERBS_KEY);
    } catch (e) {
    }
    renderVerbs();
    renderEditor();
  }
  function addVerbFromUI(verb) {
    saveVerbs(addVerb(loadVerbs(), verb));
    renderVerbs();
    renderEditor();
  }
  function removeVerbFromUI(verb) {
    if (selectedVerb === verb) {
      selectedVerb = null;
    }
    saveVerbs(removeVerb(loadVerbs(), verb));
    renderVerbs();
    renderEditor();
  }
  function moveVerbFromUI(verb, toIndex) {
    saveVerbs(moveVerb(loadVerbs(), verb, toIndex));
    renderVerbs();
    renderEditor();
  }
  function selectVerb(verb) {
    selectedVerb = verb !== null && loadVerbs().includes(verb) ? verb : null;
    renderSelection();
  }
  function selectedVerbName() {
    return selectedVerb;
  }
  function renderSelection() {
    for (const chip of document.querySelectorAll("#ifb-editor .ifb-verbchip")) {
      const on = chip.getAttribute("data-verb") === selectedVerb;
      chip.classList.toggle("ifb-selected", on);
      chip.setAttribute("aria-pressed", String(on));
    }
    const has = selectedVerb !== null;
    for (const sel of [".ifb-moveleft", ".ifb-moveright", ".ifb-deleteverb"]) {
      const btn = document.querySelector("#ifb-editor " + sel);
      if (btn) {
        btn.disabled = !has;
      }
    }
  }
  function moveSelected(delta) {
    var _a;
    const verb = selectedVerb;
    if (verb === null) {
      return;
    }
    const at = loadVerbs().indexOf(verb);
    if (at === -1) {
      return;
    }
    moveVerbFromUI(verb, at + delta);
    (_a = document.querySelector('#ifb-editor .ifb-verbchip[data-verb="' + verb + '"]')) == null ? void 0 : _a.focus();
  }
  function deleteSelected() {
    if (selectedVerb !== null) {
      removeVerbFromUI(selectedVerb);
    }
  }
  function button(label, cls, onTap, ariaLabel) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ifb " + cls;
    b.textContent = label;
    if (ariaLabel) {
      b.setAttribute("aria-label", ariaLabel);
    }
    b.addEventListener("click", () => onTap(b));
    return b;
  }
  function renderVerbs() {
    const host = document.querySelector("#ifb-bar .ifb-verbs");
    if (!host) {
      return;
    }
    while (host.firstChild) {
      host.removeChild(host.firstChild);
    }
    for (const v of loadVerbs()) {
      const label = v.startsWith("/") ? v : v.charAt(0).toUpperCase() + v.slice(1);
      host.appendChild(button(label, "ifb-verb", (btn) => apply(tapVerb(state, v), btn, "stage")));
    }
    measureBar();
  }
  function verbChip(verb) {
    const chip = button(verb, "ifb-verbchip", () => {
      if (suppressNextChipClick) {
        suppressNextChipClick = false;
        return;
      }
      selectVerb(selectedVerb === verb ? null : verb);
    }, verb + " \u2014 tap to select, drag to reorder");
    chip.setAttribute("data-verb", verb);
    chip.setAttribute("aria-pressed", String(selectedVerb === verb));
    chip.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        selectVerb(verb);
        moveSelected(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeVerbFromUI(verb);
      }
    });
    return chip;
  }
  var suppressNextChipClick = false;
  function chipIndex(chip) {
    return chip.parentElement ? [...chip.parentElement.children].indexOf(chip) : -1;
  }
  function enableChipDragging(list) {
    let chip = null;
    let originX = 0;
    let moved = false;
    const pointFrom = (e) => {
      const t = e.touches;
      if (t && t.length > 0) {
        const first = t[0];
        return first ? { x: first.clientX, y: first.clientY } : null;
      }
      const m = e;
      return typeof m.clientX === "number" ? { x: m.clientX, y: m.clientY } : null;
    };
    const start = (e) => {
      const target = e.target;
      if (!(target instanceof Element)) {
        return;
      }
      const found = target.closest(".ifb-verbchip");
      if (!found || found.parentElement !== list) {
        return;
      }
      const p = pointFrom(e);
      chip = found;
      originX = p ? p.x : 0;
      moved = false;
    };
    const move = (e) => {
      var _a;
      if (!chip) {
        return;
      }
      const p = pointFrom(e);
      if (!p) {
        return;
      }
      if (!moved && Math.abs(p.x - originX) < MIN_DRAG_PX) {
        return;
      }
      if (!moved) {
        moved = true;
        chip.classList.add("ifb-dragging");
      }
      if (e.cancelable) {
        e.preventDefault();
      }
      const bar = document.getElementById("ifb-bar");
      if (bar) {
        const r = bar.getBoundingClientRect();
        if (p.y < r.top + 36) {
          bar.scrollTop -= 12;
        } else if (p.y > r.bottom - 36) {
          bar.scrollTop += 12;
        }
      }
      const under = (_a = document.elementFromPoint(p.x, p.y)) == null ? void 0 : _a.closest(".ifb-verbchip");
      if (!under || under === chip || under.parentElement !== list) {
        return;
      }
      const box = under.getBoundingClientRect();
      list.insertBefore(chip, p.x > box.left + box.width / 2 ? under.nextSibling : under);
    };
    const end = () => {
      var _a;
      if (!chip) {
        return;
      }
      const dropped = chip;
      const wasDrag = moved;
      chip = null;
      moved = false;
      if (!wasDrag) {
        return;
      }
      dropped.classList.remove("ifb-dragging");
      suppressNextChipClick = true;
      const verb = dropped.getAttribute("data-verb");
      const to = chipIndex(dropped);
      if (verb !== null && to !== -1) {
        selectedVerb = verb;
        moveVerbFromUI(verb, to);
        (_a = document.querySelector('#ifb-editor .ifb-verbchip[data-verb="' + verb + '"]')) == null ? void 0 : _a.focus();
      }
    };
    if (typeof window.PointerEvent === "function") {
      list.addEventListener("pointerdown", start);
      list.addEventListener("pointermove", move);
      list.addEventListener("pointerup", end);
      list.addEventListener("pointercancel", end);
    } else {
      list.addEventListener("mousedown", start);
      list.addEventListener("touchstart", start, { passive: false });
      list.addEventListener("mousemove", move);
      list.addEventListener("touchmove", move, { passive: false });
      list.addEventListener("mouseup", end);
      list.addEventListener("touchend", end);
      list.addEventListener("touchcancel", end);
    }
  }
  function renderEditor() {
    const panel = document.getElementById("ifb-editor");
    if (!panel) {
      return;
    }
    while (panel.firstChild) {
      panel.removeChild(panel.firstChild);
    }
    const row = document.createElement("div");
    row.className = "ifb-editrow";
    row.appendChild(button("\u2715 Close", "ifb-closeeditor", () => {
      closeEditor();
    }, "Close settings"));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ifb-newverb";
    input.placeholder = "add a verb, e.g. dig";
    input.setAttribute("aria-label", "New verb");
    input.setAttribute("autocapitalize", "none");
    row.appendChild(input);
    row.appendChild(button("Add", "ifb-addverb", () => {
      addVerbFromUI(input.value);
      input.value = "";
    }));
    row.appendChild(button("Defaults", "ifb-resetverbs", () => resetVerbs()));
    row.appendChild(button(
      "\u25C0",
      "ifb-moveleft",
      () => {
        moveSelected(-1);
      },
      "Move the selected word earlier"
    ));
    row.appendChild(button(
      "\u25B6",
      "ifb-moveright",
      () => {
        moveSelected(1);
      },
      "Move the selected word later"
    ));
    row.appendChild(button(
      "Delete",
      "ifb-deleteverb",
      () => {
        deleteSelected();
      },
      "Delete the selected word"
    ));
    panel.appendChild(row);
    const list = document.createElement("div");
    list.className = "ifb-verblist";
    for (const v of loadVerbs()) {
      list.appendChild(verbChip(v));
    }
    enableChipDragging(list);
    panel.appendChild(list);
    renderSelection();
    measureBar();
  }
  function openEditor() {
    const bar = document.getElementById("ifb-bar");
    if (!bar) {
      return;
    }
    renderEditor();
    bar.classList.add("ifb-editing");
    measureBar();
  }
  function closeEditor() {
    const bar = document.getElementById("ifb-bar");
    if (!bar) {
      return;
    }
    bar.classList.remove("ifb-editing");
    measureBar();
  }
  function isEditorOpen() {
    var _a, _b;
    return (_b = (_a = document.getElementById("ifb-bar")) == null ? void 0 : _a.classList.contains("ifb-editing")) != null ? _b : false;
  }
  function toggleEditor() {
    if (isEditorOpen()) {
      closeEditor();
    } else {
      openEditor();
    }
  }
  function buildBar() {
    const existing = document.getElementById("ifb-bar");
    if (existing) {
      return existing;
    }
    const bar = document.createElement("div");
    bar.id = "ifb-bar";
    const row = document.createElement("div");
    row.className = "ifb-row";
    const moves = document.createElement("div");
    moves.className = "ifb-group ifb-moves";
    for (const [label, cmd] of MOVES) {
      moves.appendChild(button(label, "ifb-move", () => {
        tapDirection(cmd);
      }));
    }
    moves.appendChild(button(
      "\u21B5",
      "ifb-enter",
      () => {
        pressEnter();
      },
      "Press Enter \u2014 submit the input as it stands, or advance a prompt"
    ));
    moves.appendChild(button("\u2699", "ifb-editverbs", () => {
      toggleEditor();
    }, "Settings \u2014 edit the word list"));
    row.appendChild(moves);
    const verbs = document.createElement("div");
    verbs.className = "ifb-group ifb-verbs";
    row.appendChild(verbs);
    const actions = document.createElement("div");
    actions.className = "ifb-group ifb-actions";
    actions.appendChild(button(
      "\u2715",
      "ifb-cancel",
      () => {
        cancelPending();
      },
      "Clear the command being built"
    ));
    row.appendChild(actions);
    bar.appendChild(row);
    const editor = document.createElement("div");
    editor.id = "ifb-editor";
    bar.appendChild(editor);
    document.body.appendChild(bar);
    renderVerbs();
    watchBarSize(bar);
    return bar;
  }
  function reserveViewportBottom(barTop, barHeight) {
    for (const el of document.querySelectorAll("[data-ifb-lifted]")) {
      el.style.removeProperty("max-height");
      el.style.removeProperty("bottom");
      el.style.removeProperty("top");
      el.style.removeProperty("overflow-y");
      el.removeAttribute("data-ifb-lifted");
    }
    if (barHeight <= 0) {
      return;
    }
    const bar = document.getElementById("ifb-bar");
    const candidates = [document.body, ...document.querySelectorAll("body *")];
    for (const el of candidates) {
      try {
        if (el === bar || (bar == null ? void 0 : bar.contains(el))) {
          continue;
        }
        const cs = window.getComputedStyle(el);
        if (cs.position !== "fixed") {
          continue;
        }
        const rect = el.getBoundingClientRect();
        const overlap = rect.bottom - barTop;
        if (overlap <= 1 || rect.height < 8) {
          continue;
        }
        const topPinned = cs.top !== "auto";
        if (topPinned && rect.height - overlap >= MIN_LIFTED_HEIGHT) {
          el.style.setProperty("max-height", Math.round(rect.height - overlap) + "px", "important");
        } else if (topPinned) {
          const top = Number.parseFloat(cs.top);
          if (!Number.isFinite(top)) {
            continue;
          }
          el.style.setProperty("top", Math.round(top - overlap) + "px", "important");
        } else {
          const bottom = Number.parseFloat(cs.bottom);
          el.style.setProperty("bottom", Math.round((Number.isFinite(bottom) ? bottom : 0) + barHeight) + "px", "important");
        }
        el.setAttribute("data-ifb-lifted", "1");
      } catch (e) {
      }
    }
    for (const el of document.querySelectorAll("[data-ifb-lifted]")) {
      try {
        if (window.getComputedStyle(el).overflowY !== "visible") {
          continue;
        }
        if (el.scrollHeight <= el.clientHeight + 2) {
          continue;
        }
        el.style.setProperty("overflow-y", "auto", "important");
      } catch (e) {
      }
    }
  }
  function measureBar() {
    const bar = document.getElementById("ifb-bar");
    if (!bar) {
      return 0;
    }
    const height = Math.ceil(bar.getBoundingClientRect().height);
    if (height <= 0) {
      return 0;
    }
    const root = document.documentElement;
    const next = height + "px";
    if (root.style.getPropertyValue("--ifb-bar-height") === next) {
      return height;
    }
    const bw = bufferWindow();
    const wasAtEnd = bw !== null && bw.scrollHeight - bw.scrollTop - bw.clientHeight < 4;
    root.style.setProperty("--ifb-bar-height", next);
    if (bw && wasAtEnd) {
      bw.scrollTop = bw.scrollHeight;
    }
    reserveViewportBottom(bar.getBoundingClientRect().top, height);
    return height;
  }
  function watchBarSize(bar) {
    measureBar();
    if (typeof ResizeObserver === "function") {
      barSizeObserver == null ? void 0 : barSizeObserver.disconnect();
      barSizeObserver = new ResizeObserver(() => {
        measureBar();
      });
      barSizeObserver.observe(bar);
    }
    if (!barResizeBound) {
      barResizeBound = true;
      window.addEventListener("resize", () => {
        measureBar();
      });
    }
  }
  function adoptHostFeatures() {
    const mapPane = document.querySelector(MAP_SELECTORS);
    if (!mapPane) {
      return;
    }
    document.documentElement.classList.add("ifb-host-map");
    const actions = document.querySelector("#ifb-bar .ifb-actions");
    if (!actions || actions.querySelector(".ifb-maptoggle")) {
      return;
    }
    const toggle = button("\u229E", "ifb-maptoggle", (btn) => {
      const collapsed = document.documentElement.classList.toggle("ifb-map-collapsed");
      mapPane.style.display = collapsed ? "none" : "";
      btn.setAttribute("aria-pressed", String(collapsed));
    }, "Show or hide the map");
    toggle.setAttribute("aria-pressed", "false");
    actions.appendChild(toggle);
    measureBar();
  }
  function boot(triesLeft) {
    if (watchBuffer()) {
      buildBar();
      adoptHostFeatures();
      return true;
    }
    if (triesLeft > 0) {
      bootTimer = setTimeout(() => boot(triesLeft - 1), 500);
    }
    return false;
  }
  function stopBoot() {
    if (bootTimer !== null) {
      clearTimeout(bootTimer);
      bootTimer = null;
    }
  }
  function currentState() {
    return state;
  }
  window.IFButtons = {
    findLineInput,
    inputMode,
    submitCommand,
    stageCommand,
    cancelPending,
    pressEnter,
    tapDirection,
    dismissMorePrompt,
    decorateBuffer,
    watchBuffer,
    buildBar,
    adoptHostFeatures,
    measureBar,
    loadVerbs,
    saveVerbs,
    resetVerbs,
    addVerbFromUI,
    removeVerbFromUI,
    moveVerbFromUI,
    selectVerb,
    selectedVerbName,
    moveSelected,
    deleteSelected,
    renderVerbs,
    openEditor,
    closeEditor,
    toggleEditor,
    isEditorOpen,
    boot,
    stopBoot,
    currentState
  };
  if (document.readyState !== "loading") {
    boot(40);
  } else {
    document.addEventListener("DOMContentLoaded", () => boot(40));
  }
})();
