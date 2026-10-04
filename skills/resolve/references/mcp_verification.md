# MCP-Верификация (resolve)

## 1. Порядок Проверки

- **После каждого шага** → опрос состояния через MCP (доступный MCP-сервер проекта).
- Доменные примеры инструментов: `get_editor_state` / `get_app_state`, `get_plugins_status`, `inspect_item` и др.
- Имя инструмента → в лог чата.
- **Runtime-целостность**: отсутствие runtime-ошибок, корректный статус плагинов и элементов.

## 2. Fallback и Краевые Случаи

- **Сбой точечных MCP-методов** (например, `inspect_item`) → fallback на `get_editor_state`.
- **Недоступен веб-интерфейс / закрыт браузер** → запустить его принудительно через интерактивную задачу (обход ограничений фоновой сессии):
  1. Выполнить `whoami` для получения имени пользователя (например, `desktop-xyz\user`).
  2. Зарегистрировать интерактивную задачу: `schtasks /create /tn "OpenBrowserForAgent" /tr "cmd.exe /c start http://localhost:3001" /sc once /st 00:00 /ru <ИМЯ_ПОЛЬЗОВАТЕЛЯ> /it /f`
  3. Запустить задачу: `schtasks /run /tn "OpenBrowserForAgent"`
  4. Удалить задачу: `schtasks /delete /tn "OpenBrowserForAgent" /f`
  5. В случае неудачи → вызов `reload_browser` или лог статуса (без маскировки ошибок `tsc`/lint).
