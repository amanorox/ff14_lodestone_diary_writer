    (() => {
      const STORAGE_KEY = "lodestone-diary-editor-v1";
      const DRAFT_FORMAT = "lodestone-bbcode";
      const MAX_BODY_LENGTH = 10000;
      const editor = document.getElementById("editor");
      const titleInput = document.getElementById("title-input");
      const charCount = document.getElementById("char-count");
      const titleCount = document.getElementById("title-count");
      const saveState = document.getElementById("save-state");
      const previewPane = document.getElementById("preview-pane");
      const previewToggle = document.getElementById("preview-toggle");
      const colorPopover = document.getElementById("color-popover");
      let savedSelectionStart = 0;
      let savedSelectionEnd = 0;
      let saveTimer = 0;
      let toastTimer = 0;
      let migrationHadImages = false;

      const colors = ["#000000", "#FFFFFF", "#FF0000", "#CC0000", "#FF9933", "#FFFF00", "#00CC00", "#009900", "#6699FF", "#9900FF", "#FF66CC", "#990066"];
      colors.forEach((color) => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "swatch";
        swatch.style.backgroundColor = color;
        swatch.setAttribute("aria-label", `文字色 ${color}`);
        swatch.addEventListener("click", () => {
          if (insertTag(`[color=${color}]`, "[/color]")) colorPopover.classList.remove("open");
        });
        colorPopover.insertBefore(swatch, colorPopover.querySelector(".color-custom"));
      });

      function escapeHTML(value) {
        return value.replace(/[&<>"']/g, (character) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        })[character]);
      }

      function safeUrl(value) {
        try {
          const url = new URL(value);
          return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
        } catch {
          return null;
        }
      }

      function rememberSelection() {
        if (document.activeElement !== editor) return;
        savedSelectionStart = editor.selectionStart;
        savedSelectionEnd = editor.selectionEnd;
      }

      function getSavedSelection() {
        const valueLength = editor.value.length;
        return {
          start: Math.min(savedSelectionStart, valueLength),
          end: Math.min(Math.max(savedSelectionEnd, savedSelectionStart), valueLength)
        };
      }

      function setSelectionAndNotify(start, end) {
        editor.focus();
        editor.setSelectionRange(start, end);
        rememberSelection();
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }

      function insertTextAtSelection(text) {
        const { start, end } = getSavedSelection();
        if (editor.value.length - (end - start) + text.length > MAX_BODY_LENGTH) {
          showToast("本文は10,000文字まで入力できます。");
          return false;
        }
        const cursor = start + text.length;
        editor.setRangeText(text, start, end, "end");
        setSelectionAndNotify(cursor, cursor);
        return true;
      }

      function insertTag(openTag, closeTag) {
        const { start, end } = getSavedSelection();
        const selectedText = editor.value.slice(start, end);
        const wrapped = `${openTag}${selectedText}${closeTag}`;
        if (editor.value.length - (end - start) + wrapped.length > MAX_BODY_LENGTH) {
          showToast("タグを追加すると本文が10,000文字を超えます。");
          return false;
        }
        const innerStart = start + openTag.length;
        editor.setRangeText(wrapped, start, end, "end");
        setSelectionAndNotify(innerStart, innerStart + selectedText.length);
        return true;
      }

      function renderTags(source) {
        let html = escapeHTML(source);
        html = html.replace(/\[size=(\d{1,2})\]([\s\S]*?)\[\/size\]/gi, (tag, size, content) => {
          const value = Number(size);
          return value >= 9 && value <= 32 ? `<span style="font-size:${value}px">${content}</span>` : tag;
        });
        html = html.replace(/\[color=(#[0-9a-f]{3,8}|[a-z]{3,20})\]([\s\S]*?)\[\/color\]/gi, (_tag, color, content) => {
          return `<span style="color:${color}">${content}</span>`;
        });
        [["b", "strong"], ["i", "em"], ["u", "u"], ["s", "s"]].forEach(([tag, element]) => {
          html = html.replace(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "gi"), `<${element}>$1</${element}>`);
        });
        html = html.replace(/\[url=(https?:\/\/[^\]\s]+)\]([\s\S]*?)\[\/url\]/gi, (tag, rawUrl, content) => {
          const url = safeUrl(rawUrl.replace(/&amp;/g, "&"));
          return url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${content}</a>` : tag;
        });
        html = html.replace(/\[url\](https?:\/\/[\s\S]*?)\[\/url\]/gi, (tag, rawUrl) => {
          const url = safeUrl(rawUrl.replace(/&amp;/g, "&").trim());
          return url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(url)}</a>` : tag;
        });
        ["left", "center", "right"].forEach((alignment) => {
          html = html.replace(new RegExp(`\\[${alignment}\\]([\\s\\S]*?)\\[\\/${alignment}\\]`, "gi"), `<div style="text-align:${alignment}">$1</div>`);
        });
        html = html.replace(/\[hb\]([\s\S]*?)\[\/hb\]/gi, '<details class="spoiler"><summary>クリックして表示</summary>$1</details>');
        html = html.replace(/\[db:image=([^\]]+)\]/gi, (_tag, id) => {
          return `<span class="media-placeholder">Lodestone画像: ${id}</span>`;
        });
        html = html.replace(/\[(youtube|twitch)\]([\s\S]*?)\[\/\1\]/gi, (_tag, kind, value) => {
          const url = safeUrl(value.replace(/&amp;/g, "&").trim());
          if (!url) return _tag;
          const hostname = new URL(url).hostname.toLowerCase();
          const allowed = kind.toLowerCase() === "youtube"
            ? hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com")
            : hostname === "twitch.tv" || hostname.endsWith(".twitch.tv");
          return allowed
            ? `<span class="video-placeholder">▶ ${kind.toUpperCase()} 動画: <a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">開く</a></span>`
            : _tag;
        });
        return html.replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
      }

      function colorToTagValue(value) {
        const hex = value.match(/^#[0-9a-f]{6}$/i)?.[0];
        if (hex) return hex.toUpperCase();
        const rgb = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
        if (!rgb) return null;
        return `#${rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
      }

      function migrateLegacyHtml(html) {
        const documentCopy = new DOMParser().parseFromString(html, "text/html");
        let hadImages = false;
        function convert(node) {
          if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
          if (node.nodeType !== Node.ELEMENT_NODE) return "";
          const element = node;
          const tagName = element.tagName.toLowerCase();
          if (tagName === "br") return "\n";
          if (tagName === "img") {
            hadImages = true;
            return "[db:image=画像IDを設定]";
          }
          if (tagName === "iframe") {
            const src = element.getAttribute("src") || "";
            const youtubeId = src.match(/youtube(?:-nocookie)?\.com\/embed\/([^/?]+)/i)?.[1];
            if (youtubeId) return `[youtube]https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}[/youtube]`;
            return "";
          }
          if (tagName === "details") {
            const content = [...element.childNodes].filter((child) => !(child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "summary")).map(convert).join("");
            return `[hb]${content}[/hb]`;
          }
          let content = [...element.childNodes].map(convert).join("");
          if (tagName === "b" || tagName === "strong") content = `[b]${content}[/b]`;
          else if (tagName === "i" || tagName === "em") content = `[i]${content}[/i]`;
          else if (tagName === "u") content = `[u]${content}[/u]`;
          else if (tagName === "s" || tagName === "strike" || tagName === "del") content = `[s]${content}[/s]`;
          else if (tagName === "a") {
            const url = safeUrl(element.getAttribute("href") || "");
            if (url) content = `[url=${url}]${content}[/url]`;
          }
          const style = element.getAttribute("style") || "";
          const size = style.match(/font-size:\s*(\d+(?:\.\d+)?)px/i)?.[1];
          if (size) {
            const pixels = Number(size);
            const lodestoneSize = pixels <= 12 ? 10 : pixels <= 16 ? 12 : pixels <= 22 ? 18 : 32;
            content = `[size=${lodestoneSize}]${content}[/size]`;
          }
          const color = colorToTagValue(style.match(/color:\s*(#[0-9a-f]{3,8}|rgb\([^)]+\))/i)?.[1] || "");
          if (color) content = `[color=${color}]${content}[/color]`;
          if (["p", "div", "blockquote"].includes(tagName)) content += "\n";
          return content;
        }
        const body = [...documentCopy.body.childNodes].map(convert).join("").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
        return { body, hadImages };
      }

      function updateEditor() {
        const length = editor.value.length;
        charCount.textContent = `${length.toLocaleString("ja-JP")} / 10,000`;
        charCount.classList.toggle("over", length > MAX_BODY_LENGTH);
        titleCount.textContent = `${titleInput.value.length} / 50`;
        previewPane.innerHTML = renderTags(editor.value);
        queueSave();
      }

      function queueSave() {
        saveState.textContent = "保存中…";
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(saveDraft, 350);
      }

      function saveDraft() {
        const draft = { format: DRAFT_FORMAT, title: titleInput.value, body: editor.value };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
          saveState.textContent = "自動保存済み";
        } catch (error) {
          console.error("下書きを保存できませんでした。", error);
          saveState.textContent = "保存できませんでした";
          showToast("端末の保存領域が不足しているため、下書きを保存できませんでした。");
        }
      }

      function loadDraft() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        try {
          const draft = JSON.parse(raw);
          if (typeof draft.title === "string") titleInput.value = draft.title.slice(0, 50);
          if (typeof draft.body === "string") {
            if (draft.format === DRAFT_FORMAT) {
              editor.value = draft.body;
            } else if (/<\/?(?:b|strong|i|em|u|s|strike|del|span|a|div|p|details|img|iframe)\b/i.test(draft.body)) {
              const migrated = migrateLegacyHtml(draft.body);
              editor.value = migrated.body;
              migrationHadImages = migrated.hadImages;
            } else {
              editor.value = draft.body;
            }
          }
          updateEditor();
          saveState.textContent = draft.format === DRAFT_FORMAT
            ? "保存した下書きを復元しました"
            : "旧形式の下書きをタグ付きテキストに変換しました";
          if (migrationHadImages) {
            showToast("旧形式の画像をLodestone画像タグに変換しました。画像IDを設定してください。");
          }
        } catch (error) {
          console.error("保存した下書きを読み込めませんでした。", error);
          saveState.textContent = "下書きを読み込めませんでした";
          showToast("保存した下書きを読み込めませんでした。");
        }
      }

      function showToast(message) {
        const toast = document.getElementById("toast");
        toast.textContent = message;
        toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
      }

      function openDialog(id, inputId) {
        rememberSelection();
        const dialog = document.getElementById(id);
        document.getElementById(inputId).value = "";
        dialog.showModal();
        document.getElementById(inputId).focus();
      }

      document.querySelectorAll(".toolbar .tool").forEach((button) => {
        button.addEventListener("pointerdown", (event) => {
          rememberSelection();
          event.preventDefault();
        });
      });

      document.querySelectorAll("[data-tag]").forEach((button) => {
        button.addEventListener("click", () => {
          const tag = button.dataset.tag;
          const openTag = tag === "size" ? `[size=${button.dataset.size}]` : `[${tag}]`;
          insertTag(openTag, `[/${tag}]`);
        });
      });

      document.getElementById("color-button").addEventListener("click", () => {
        rememberSelection();
        colorPopover.classList.toggle("open");
      });
      document.getElementById("custom-color").addEventListener("change", (event) => {
        if (insertTag(`[color=${event.target.value.toUpperCase()}]`, "[/color]")) colorPopover.classList.remove("open");
      });
      document.getElementById("link-button").addEventListener("click", () => openDialog("link-dialog", "link-url"));
      document.getElementById("video-button").addEventListener("click", () => openDialog("video-dialog", "video-url"));
      document.getElementById("image-button").addEventListener("click", () => {
        openDialog("image-dialog", "image-id");
      });
      document.getElementById("share-button").addEventListener("click", async () => {
        const body = editor.value;
        if (!body.trim()) {
          showToast("共有する本文を入力してください。");
          return;
        }

        try {
          if (navigator.share) {
            await navigator.share({ text: body });
          } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(body);
            showToast("共有機能に対応していないため、本文をコピーしました。");
          } else {
            showToast("このブラウザーでは共有機能を利用できません。");
          }
        } catch (error) {
          if (error.name === "AbortError") return;
          console.error("本文を共有できませんでした。", error);
          showToast("本文を共有できませんでした。");
        }
      });
      document.getElementById("spoiler-button").addEventListener("click", () => {
        insertTag("[hb]", "[/hb]");
      });

      document.getElementById("link-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const url = safeUrl(document.getElementById("link-url").value.trim());
        if (!url) {
          showToast("http:// または https:// から始まるURLを入力してください。");
          return;
        }
        const { start, end } = getSavedSelection();
        const selectedText = editor.value.slice(start, end);
        const inserted = selectedText
          ? insertTag(`[url=${url}]`, "[/url]")
          : insertTextAtSelection(`[url=${url}]${url}[/url]`);
        if (inserted) document.getElementById("link-dialog").close();
      });

      document.getElementById("video-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const url = safeUrl(document.getElementById("video-url").value.trim());
        if (!url) {
          showToast("http:// または https:// から始まる動画URLを入力してください。");
          return;
        }
        const hostname = new URL(url).hostname.toLowerCase();
        const kind = hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com")
          ? "youtube"
          : hostname === "twitch.tv" || hostname.endsWith(".twitch.tv")
            ? "twitch"
            : null;
        if (!kind) {
          showToast("YouTubeまたはTwitchの動画URLを入力してください。");
          return;
        }
        if (insertTextAtSelection(`[${kind}]${url}[/${kind}]`)) {
          document.getElementById("video-dialog").close();
        }
      });

      document.getElementById("image-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const id = document.getElementById("image-id").value.trim();
        if (!/^[\w-]+$/.test(id)) {
          showToast("画像IDは英数字、ハイフン、アンダースコアで入力してください。");
          return;
        }
        if (insertTextAtSelection(`[db:image=${id}]`)) {
          document.getElementById("image-dialog").close();
        }
      });

      document.querySelectorAll("[data-close]").forEach((button) => {
        button.addEventListener("click", () => document.getElementById(button.dataset.close).close());
      });

      function togglePreview(show) {
        previewPane.classList.toggle("show", show);
        document.querySelector(".editor-area").classList.toggle("hidden", show);
        previewToggle.textContent = show ? "編集に戻る" : "プレビュー";
        if (show) previewPane.focus();
      }
      previewToggle.addEventListener("click", () => togglePreview(!previewPane.classList.contains("show")));
      document.getElementById("edit-again").addEventListener("click", () => togglePreview(false));

      document.getElementById("clear-button").addEventListener("click", () => {
        if ((titleInput.value || editor.value) && !window.confirm("入力内容を消去して新しい日記を作成しますか？")) return;
        titleInput.value = "";
        editor.value = "";
        localStorage.removeItem(STORAGE_KEY);
        saveState.textContent = "新しい日記";
        updateEditor();
        editor.focus();
      });

      titleInput.addEventListener("input", updateEditor);
      editor.addEventListener("input", () => {
        rememberSelection();
        updateEditor();
      });
      editor.addEventListener("select", rememberSelection);
      editor.addEventListener("keyup", rememberSelection);
      editor.addEventListener("click", rememberSelection);
      editor.addEventListener("beforeinput", (event) => {
        if (!event.inputType.startsWith("insert")) return;
        const { start, end } = getSavedSelection();
        const currentLength = editor.value.length - (end - start);
        let incoming = event.data;
        if (incoming === null && event.dataTransfer) incoming = event.dataTransfer.getData("text/plain");
        if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") incoming = "\n";
        if (incoming !== null && incoming !== "" && currentLength + incoming.length > MAX_BODY_LENGTH) {
          event.preventDefault();
          const available = Math.max(0, MAX_BODY_LENGTH - currentLength);
          if (available > 0) {
            const inserted = incoming.slice(0, available);
            editor.setRangeText(inserted, start, end, "end");
            editor.dispatchEvent(new Event("input", { bubbles: true }));
          }
          showToast("本文は10,000文字まで入力できます。");
        } else if (currentLength >= MAX_BODY_LENGTH && incoming !== "\n") {
          event.preventDefault();
          showToast("本文は10,000文字まで入力できます。");
        }
      });
      editor.addEventListener("paste", (event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined || text === "") return;
        const { start, end } = getSavedSelection();
        const available = Math.max(0, MAX_BODY_LENGTH - editor.value.length + (end - start));
        if (text.length > available) {
          event.preventDefault();
          editor.setRangeText(text.slice(0, available), start, end, "end");
          editor.dispatchEvent(new Event("input", { bubbles: true }));
          showToast("本文は10,000文字まで入力できます。");
        }
      });
      document.addEventListener("click", (event) => {
        if (!event.target.closest("#color-button, #color-popover")) colorPopover.classList.remove("open");
      });

      window.addEventListener("pagehide", saveDraft);
      loadDraft();
    })();