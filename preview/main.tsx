import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GitLabTab } from "../app";
import { setScenario } from "./fixtures";
function Preview() {
  const [mode, setMode] = useState("failed"),
    [dark, setDark] = useState(true),
    [width, setWidth] = useState(420);
  return (
    <div className={dark ? "dark" : ""}>
      <div className="preview-controls">
        <strong>GitLab Branch · тестовые данные</strong>
        <select
          aria-label="Сценарий"
          value={mode}
          onChange={(e) => {
            setScenario(e.target.value);
            setMode(e.target.value);
          }}
        >
          <option value="failed">CI упал</option>
          <option value="running">CI выполняется</option>
          <option value="ready">Готов к слиянию</option>
        </select>
        <button onClick={() => setDark(!dark)}>Тема</button>
        {[320, 420, 680].map((w) => (
          <button key={w} onClick={() => setWidth(w)}>
            {w}px
          </button>
        ))}
      </div>
      <div className="preview-layout">
        <div className="preview-frame" style={{ width }}>
          <GitLabTab
            key={mode}
            threadId="preview"
            environment={{ id: "demo" }}
          />
        </div>
        <details>
          <summary>Черновик запроса</summary>
          <pre id="draft">Действия в панели добавляют сюда контекст.</pre>
        </details>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
