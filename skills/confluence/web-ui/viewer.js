/* global window, document, localStorage, navigator, fetch, setTimeout, clearTimeout, alert, console */
let currentData = {};
let searchTimeout = null;
let isResizing = false;
let currentDiffMode = "render";
let currentRemoteUrl = "";
let currentPageContent = "";
let isFlatSort = false;

let justSyncedIds = [];
try {
  const stored = JSON.parse(localStorage.getItem("syncedItems"));
  if (stored && Date.now() - stored.time < 24 * 60 * 60 * 1000) {
    justSyncedIds = stored.ids || [];
  } else {
    localStorage.removeItem("syncedItems");
  }
} catch {
  // ignore
}

const iconChevronDown = `<svg class="icon" viewBox="0 0 24 24"><use href="/icons.svg#icon-chevron-down"></use></svg>`;
const iconChevronRight = `<svg class="icon" viewBox="0 0 24 24"><use href="/icons.svg#icon-chevron-right"></use></svg>`;
const iconCopy = `<svg class="icon" viewBox="0 0 24 24"><use href="/icons.svg#icon-copy"></use></svg>`;
const iconCheck = `<svg class="icon" viewBox="0 0 24 24"><use href="/icons.svg#icon-check"></use></svg>`;

const themeToggle = document.getElementById("themeToggle");
if (localStorage.getItem("theme") === "dark") document.body.classList.add("dark-mode");
themeToggle.onclick = () => {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem("theme", document.body.classList.contains("dark-mode") ? "dark" : "light");
};

function customConfirm(
  title = "Синхронизировать с Confluence?",
  desc = "Это загрузит последние изменения с удаленного сервера.",
) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    document.getElementById("confirmModalTitle").innerText = title;
    document.getElementById("confirmModalDesc").innerText = desc;
    modal.style.display = "flex";

    document.getElementById("modalConfirmBtn").onclick = () => {
      modal.style.display = "none";
      resolve(true);
    };
    document.getElementById("modalCancelBtn").onclick = () => {
      modal.style.display = "none";
      resolve(false);
    };
  });
}

document.getElementById("syncBtn").onclick = async () => {
  const confirmed = await customConfirm();
  if (!confirmed) return;

  const oldData = { ...currentData };
  const syncIcon = document.querySelector("#syncBtn svg");
  syncIcon.classList.add("spinning");

  document.getElementById("pageContent").style.display = "none";
  document.getElementById("loader").innerText = "Синхронизация...";
  document.getElementById("loader").style.display = "block";

  try {
    const res = await fetch("/api/sync_server", { method: "POST" });
    if (res.ok) {
      await loadTree();

      const updated = [];
      for (const [id, item] of Object.entries(currentData)) {
        const oldItem = oldData[id];
        if (
          !oldItem ||
          item.remoteVersion > oldItem.remoteVersion ||
          item.remoteUpdatedAt !== oldItem.remoteUpdatedAt
        ) {
          updated.push(item);
        }
      }

      if (updated.length > 0) {
        justSyncedIds = updated.map((u) => u.pageId);
        localStorage.setItem("syncedItems", JSON.stringify({ ids: justSyncedIds, time: Date.now() }));
        renderTreeOrList();

        const listHtml = "<ul>" + updated.map((u) => `<li>${u.title}</li>`).join("") + "</ul>";
        document.getElementById("resultModalContent").innerHTML =
          `Обновлено документов: <b>${updated.length}</b><br>${listHtml}`;
      } else {
        document.getElementById("resultModalContent").innerHTML = "Новых изменений нет. Все данные актуальны.";
      }

      document.getElementById("resultModal").style.display = "flex";
      document.getElementById("resultModalOkBtn").onclick = () => {
        document.getElementById("resultModal").style.display = "none";
      };
    } else alert("Ошибка синхронизации");
  } catch (e) {
    alert(e.message);
  } finally {
    syncIcon.classList.remove("spinning");
    document.getElementById("loader").style.display = "none";
  }
};

document.getElementById("sortRecentBtn").onclick = () => {
  isFlatSort = !isFlatSort;
  const btn = document.getElementById("sortRecentBtn");
  if (isFlatSort) btn.classList.add("active");
  else btn.classList.remove("active");
  renderTreeOrList();
};

document.getElementById("expandAllBtn").onclick = () => {
  document.querySelectorAll(".tree-node").forEach((node) => {
    node.classList.add("expanded");
    const btn = node.querySelector(".toggle-btn");
    if (btn && btn.innerHTML !== "") btn.innerHTML = iconChevronDown;
  });
};

document.getElementById("collapseAllBtn").onclick = () => {
  document.querySelectorAll(".tree-node").forEach((node) => {
    node.classList.remove("expanded");
    const btn = node.querySelector(".toggle-btn");
    if (btn && btn.innerHTML !== "") btn.innerHTML = iconChevronRight;
  });
};

document.getElementById("copyLinkBtn").onclick = () => {
  if (currentRemoteUrl) {
    navigator.clipboard.writeText(currentRemoteUrl);
    const btn = document.getElementById("copyLinkBtn");
    btn.innerHTML = iconCheck;
    setTimeout(() => (btn.innerHTML = iconCopy), 2000);
  }
};

document.getElementById("copyLinkBtn").ondblclick = () => {
  if (currentRemoteUrl) {
    window.open(currentRemoteUrl, "_blank");
  }
};

document.getElementById("locateBtn").onclick = () => {
  if (!currentData || !currentRemoteUrl) return;
  const idMatch = currentRemoteUrl.match(/pageId=(\d+)/);
  if (idMatch) {
    const id = idMatch[1];
    const node = document.querySelector(`.tree-item[data-id="${id}"]`);
    if (node) {
      let parent = node.parentElement;
      while (parent && parent.id !== "treeContainer") {
        if (parent.classList.contains("tree-node")) parent.classList.add("expanded");
        parent = parent.parentElement;
      }
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.style.animation = "highlight 1s";
      setTimeout(() => (node.style.animation = ""), 1000);
    }
  }
};

async function loadTree() {
  const res = await fetch("/api/tree", { cache: "no-store" });
  currentData = await res.json();
  renderTreeOrList();

  if (window.location.hash) {
    const hashId = window.location.hash.substring(1);
    if (hashId) {
      if (currentData[hashId]) {
        loadPage(hashId, currentData[hashId].title);
        setTimeout(() => document.getElementById("locateBtn").click(), 300);
      } else {
        showPageNotFound(hashId);
      }
    }
  }
}

function showPageNotFound(id) {
  document.getElementById("pageTitle").innerText = "Документ не найден";
  document.getElementById("pageContent").innerHTML =
    '<div style="padding: 20px; color: var(--meta-color);">Документ с ID <b>' +
    id +
    "</b> не найден в локальной базе.</div>";
  document.getElementById("pageContent").style.display = "block";
  document.getElementById("diffView").style.display = "none";
  if (document.getElementById("diffModeToggle")) document.getElementById("diffModeToggle").style.display = "none";
  if (document.getElementById("historySelect")) document.getElementById("historySelect").style.display = "none";
  document.getElementById("pushPatchBtn").style.display = "none";
  document.getElementById("deletePatchBtn").style.display = "none";
  document.getElementById("copyLinkBtn").style.display = "none";
  document.getElementById("locateBtn").style.display = "none";
  document.getElementById("pageMeta").innerHTML = "";
}

async function search(query) {
  if (!query) return renderTreeOrList();
  document.getElementById("pageList").innerHTML = '<li class="tree-node">Поиск...</li>';
  const res = await fetch("/api/search?q=" + encodeURIComponent(query));
  const data = await res.json();
  buildListUI(data.results);
}

function renderTreeOrList() {
  if (isFlatSort) {
    const sorted = Object.values(currentData).sort((a, b) => new Date(b.remoteUpdatedAt) - new Date(a.remoteUpdatedAt));
    buildListUI(sorted);
  } else {
    buildTreeUI(Object.values(currentData));
  }
}

function buildTreeUI(items) {
  const map = {};
  items.forEach((i) => (map[i.pageId] = { ...i, children: [] }));
  const roots = [];
  items.forEach((i) => {
    if (i.parentId && map[i.parentId]) map[i.parentId].children.push(map[i.pageId]);
    else roots.push(map[i.pageId]);
  });

  const ul = document.getElementById("pageList");
  ul.innerHTML = "";
  roots.forEach((root) => ul.appendChild(createTreeNode(root)));
}

function buildListUI(items) {
  const ul = document.getElementById("pageList");
  ul.innerHTML = "";
  if (items.length === 0) {
    ul.innerHTML = '<li class="tree-node" style="padding: 10px; color: var(--meta-color);">Ничего не найдено</li>';
    return;
  }
  items.forEach((item) => {
    item.children = []; // mock children for list rendering
    ul.appendChild(createTreeNode(item));
  });
}

function createTreeNode(node) {
  const li = document.createElement("li");
  li.className = "tree-node expanded";
  const itemDiv = createTreeItem(node);

  const titleLeftDiv = itemDiv.querySelector(".tree-item-title-left");
  const toggleBtn = document.createElement("span");
  toggleBtn.className = "toggle-btn";

  if (node.children && node.children.length > 0) {
    toggleBtn.innerHTML = iconChevronDown;
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      li.classList.toggle("expanded");
      toggleBtn.innerHTML = li.classList.contains("expanded") ? iconChevronDown : iconChevronRight;
    };
    titleLeftDiv.prepend(toggleBtn);

    const childUl = document.createElement("ul");
    node.children.forEach((child) => childUl.appendChild(createTreeNode(child)));
    li.appendChild(itemDiv);
    li.appendChild(childUl);
  } else {
    toggleBtn.innerHTML = ""; // empty space
    titleLeftDiv.prepend(toggleBtn);
    li.appendChild(itemDiv);
  }
  return li;
}

function createTreeItem(item) {
  const div = document.createElement("div");
  div.className = "tree-item";

  const updatedDiff = new Date().getTime() - new Date(item.remoteUpdatedAt).getTime();
  if (updatedDiff < 3 * 24 * 60 * 60 * 1000) {
    div.classList.add("recent-update");
  }

  if (justSyncedIds.includes(item.pageId)) {
    div.classList.add("just-synced");
  }

  div.setAttribute("data-id", item.pageId);
  const conflictBadge = item.conflict ? `<span class="badge badge-conflict">C</span>` : "";
  const unpushedBadge = item.headCommitId && item.headCommitId !== "init" ? `<span class="badge">U</span>` : "";
  div.innerHTML = `<div class="tree-item-title"><div class="tree-item-title-left"><span title="${item.title}">${item.title}</span></div> <div class="tree-item-badges">${conflictBadge}${unpushedBadge}</div></div>`;
  if (item.snippet) div.innerHTML += `<div class="snippet">${item.snippet}</div>`;
  div.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll(".tree-item").forEach((el) => el.classList.remove("selected"));
    div.classList.add("selected");
    loadPage(item.pageId, item.title);
  };
  return div;
}

async function loadPage(id, title) {
  document.getElementById("pageTitle").innerText = title || id;
  document.getElementById("pageContent").style.display = "none";
  document.getElementById("diffView").style.display = "none";
  const historySelect = document.getElementById("historySelect");
  if (historySelect) historySelect.style.display = "none";
  document.getElementById("pushPatchBtn").style.display = "none";
  document.getElementById("deletePatchBtn").style.display = "none";
  document.getElementById("copyLinkBtn").style.display = "none";
  document.getElementById("locateBtn").style.display = "none";
  document.getElementById("loader").innerText = "Загрузка...";
  document.getElementById("loader").style.display = "block";

  window.history.replaceState(null, null, "#" + id);

  try {
    const res = await fetch("/api/page?id=" + id, { cache: "no-store" });
    const data = await res.json();

    if (data.baseUrl) {
      currentRemoteUrl = `${data.baseUrl}/pages/viewpage.action?pageId=${id}`;
      document.getElementById("copyLinkBtn").style.display = "inline-flex";
      document.getElementById("locateBtn").style.display = "inline-flex";
    }

    document.getElementById("pageMeta").innerHTML = `
          v${data.index.remoteVersion} | ID: ${id} | Обновлено: ${new Date(data.index.remoteUpdatedAt).toLocaleString()}`;

    currentPageContent = data.content;
    const contentDiv = document.getElementById("pageContent");
    contentDiv.innerHTML = currentPageContent;
    contentDiv.style.display = "block";

    const hRes = await fetch("/api/history?id=" + id, { cache: "no-store" });
    if (hRes.ok) {
      const hData = await hRes.json();
      if (hData.length > 0) {
        document.getElementById("historySelect").style.display = "inline-block";
        const select = document.getElementById("historySelect");
        select.innerHTML = '<option value="">-- Просмотр документа --</option>';
        hData.reverse().forEach((h) => {
          if (h.msg === "Pushed local changes") return;
          const src = h.source === "server" ? "[Сервер]" : "[Локально]";
          const opt = document.createElement("option");
          opt.value = h.commitId;
          opt.text = `${new Date(h.timestamp).toLocaleString()} | ${src} ${h.msg}`;
          opt.dataset.source = h.source;
          select.appendChild(opt);
        });
        document.getElementById("diffView").style.display = "none";
      }
    }
  } catch (e) {
    document.getElementById("pageContent").innerText = e.message;
    document.getElementById("pageContent").style.display = "block";
  } finally {
    document.getElementById("loader").style.display = "none";
  }
}

const searchInput = document.getElementById("searchInput");
const clearBtn = document.getElementById("clearSearchBtn");

searchInput.addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const val = e.target.value;
  clearBtn.style.display = val ? "inline" : "none";
  searchTimeout = setTimeout(() => search(val), 300);
});

clearBtn.onclick = () => {
  searchInput.value = "";
  clearBtn.style.display = "none";
  search("");
};

// Sidebar resizing logic
const resizer = document.getElementById("dragResizer");
const sidebar = document.querySelector(".sidebar");
isResizing = false;

resizer.addEventListener("mousedown", () => {
  isResizing = true;
  resizer.classList.add("dragging");
  document.body.style.userSelect = "none"; // Prevent text selection
  document.body.style.cursor = "col-resize";
});

document.addEventListener("mousemove", (e) => {
  if (!isResizing) return;
  let newWidth = e.clientX;
  if (newWidth < 200) newWidth = 200;
  if (newWidth > 600) newWidth = 600;
  sidebar.style.width = newWidth + "px";
});

document.addEventListener("mouseup", () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove("dragging");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }
});

document.getElementById("diffModeCode").addEventListener("click", () => {
  currentDiffMode = "code";
  document.getElementById("diffModeCode").style.background = "var(--hover-bg)";
  document.getElementById("diffModeCode").style.color = "var(--text-color)";
  document.getElementById("diffModeRender").style.background = "transparent";
  document.getElementById("diffModeRender").style.color = "var(--meta-color)";
  const commitId = document.getElementById("historySelect").value;
  if (commitId) loadDiff(commitId);
});

document.getElementById("diffModeRender").addEventListener("click", () => {
  currentDiffMode = "render";
  document.getElementById("diffModeRender").style.background = "var(--hover-bg)";
  document.getElementById("diffModeRender").style.color = "var(--text-color)";
  document.getElementById("diffModeCode").style.background = "transparent";
  document.getElementById("diffModeCode").style.color = "var(--meta-color)";
  const commitId = document.getElementById("historySelect").value;
  if (commitId) loadDiff(commitId);
});

async function loadDiff(commitId) {
  if (!commitId) {
    document.getElementById("diffView").style.display = "none";
    document.getElementById("diffModeToggle").style.display = "none";
    document.getElementById("pageContent").style.display = "block";
    document.getElementById("pageContent").innerHTML = currentPageContent || "";
    return;
  }
  document.getElementById("diffModeToggle").style.display = "flex";

  const idMatch = currentRemoteUrl.match(/pageId=(\d+)/);
  if (!idMatch) return;

  document.getElementById("loader").innerText = "Загрузка diff...";
  document.getElementById("loader").style.display = "block";
  document.getElementById("diffView").style.display = "none";
  document.getElementById("pageContent").style.display = "none";

  try {
    if (currentDiffMode === "code") {
      const res = await fetch(`/api/diff?id=${idMatch[1]}&commitId=${commitId}`, { cache: "no-store" });
      if (res.ok) {
        const diffText = await res.text();
        const diffView = document.getElementById("diffView");
        diffView.style.display = "block";
        const lines = diffText.split("\n");
        let html =
          '<div style="font-family: Consolas, monospace; font-size: 13px; line-height: 1.5; border: 1px solid var(--border-color); border-radius: 6px; overflow: auto; background: var(--bg-color);">';

        lines.forEach((line) => {
          if (!line && lines.length === 1) return;
          let bgColor = "transparent";
          let textColor = "var(--text-color)";
          let signColor = "var(--meta-color)";
          const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          if (line.startsWith("+") && !line.startsWith("+++")) {
            bgColor = "rgba(46, 160, 67, 0.15)";
            signColor = "#3fb950";
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            bgColor = "rgba(248, 81, 73, 0.15)";
            signColor = "#f85149";
          } else if (line.startsWith("@@")) {
            bgColor = "rgba(56, 139, 253, 0.15)";
            textColor = "#58a6ff";
          } else if (
            line.startsWith("---") ||
            line.startsWith("+++") ||
            line.startsWith("Index:") ||
            line.startsWith("===")
          ) {
            bgColor = "var(--panel-bg)";
            textColor = "var(--meta-color)";
          }
          let sign = " ";
          let content = escaped;
          if (escaped.length > 0 && (escaped[0] === "+" || escaped[0] === "-")) {
            sign = escaped[0];
            content = escaped.substring(1);
          }
          html += `<div style="background-color: ${bgColor}; padding: 0 10px; display: flex; border-bottom: 1px solid rgba(128,128,128,0.05); min-width: max-content;">`;
          if (
            line.startsWith("@@") ||
            line.startsWith("---") ||
            line.startsWith("+++") ||
            line.startsWith("Index:") ||
            line.startsWith("===")
          ) {
            html += `<span style="color: ${textColor}; white-space: pre; word-break: break-all;">${escaped}</span>`;
          } else {
            html += `<span style="color: ${signColor}; width: 20px; flex-shrink: 0; user-select: none;">${sign}</span><span style="color: ${textColor}; white-space: pre; word-break: break-all;">${content}</span>`;
          }
          html += `</div>`;
        });
        html += "</div>";
        diffView.innerHTML = html;
      }
    } else {
      const res = await fetch(`/api/diff_rendered?id=${idMatch[1]}&commitId=${commitId}`, { cache: "no-store" });
      if (res.ok) {
        const htmlText = await res.text();
        const pageContent = document.getElementById("pageContent");
        pageContent.style.display = "block";
        pageContent.innerHTML = htmlText;
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    document.getElementById("loader").style.display = "none";
  }
}

document.getElementById("historySelect").addEventListener("change", async (e) => {
  const select = e.target;
  // const opt = select.options[select.selectedIndex];
  const commitId = select.value;

  document.getElementById("deletePatchBtn").style.display = commitId ? "inline-flex" : "none";
  document.getElementById("pushPatchBtn").style.display = commitId ? "inline-flex" : "none";

  loadDiff(commitId);
});

document.getElementById("deletePatchBtn").addEventListener("click", async () => {
  const commitId = document.getElementById("historySelect").value;
  if (!commitId) return;
  const confirmed = await customConfirm(
    "Удалить этот и все последующие патчи?",
    "Откат изменений необратим. Вы уверены?",
  );
  if (!confirmed) return;

  const pageId = window.location.hash.slice(1);
  const res = await fetch("/api/patch/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageId, commitId }),
  });
  if (res.ok) {
    loadPage(pageId, document.getElementById("pageTitle").innerText);
  } else {
    const err = await res.json();
    alert("Ошибка при удалении патча: " + err.error);
  }
});

document.getElementById("pushPatchBtn").addEventListener("click", async () => {
  const commitId = document.getElementById("historySelect").value;
  if (!commitId) return;
  const confirmed = await customConfirm(
    "Восстановить эту версию на сервере?",
    "Состояние страницы на момент этого патча будет отправлено в Confluence как новая версия.",
  );
  if (!confirmed) return;

  const pageId = window.location.hash.slice(1);
  document.getElementById("loader").innerText = "Отправка...";
  document.getElementById("loader").style.display = "block";
  const res = await fetch("/api/patch/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageId, commitId }),
  });
  document.getElementById("loader").style.display = "none";
  if (res.ok) {
    await loadTree(); // reload whole tree to get new versions
  } else {
    const err = await res.json();
    alert("Ошибка при отправке патча на сервер: " + err.error);
  }
});

loadTree();

window.addEventListener("hashchange", () => {
  const hashId = window.location.hash.substring(1);
  if (hashId && currentData) {
    if (currentData[hashId]) {
      loadPage(hashId, currentData[hashId].title);
      setTimeout(() => document.getElementById("locateBtn").click(), 300);
    } else {
      showPageNotFound(hashId);
    }
  }
});
