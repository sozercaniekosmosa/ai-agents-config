# Общая База Знаний Отладки (Global Troubleshooting Guide)

## 1. Таймаут ответа MCP (Timeout waiting for browser response)
- **Симптомы**: Ошибка `Timeout waiting for browser response` при вызове любых MCP-инструментов.
- **Причина 1**: Несовпадение портов Vite dev-сервера и настройки отправки регистрационного HTTP-запроса от MCP-сервера.
- **Решение 1**: Проверить список `VITE_PORTS` в `tools/mcp-server/src/index.ts` и убедиться в наличии автоматического перебора портов. Добавить авто-сброс устаревших сокетов в `mcp-bridge/index.ts`.
- **Причина 2**: Браузер закрыт, завис или запущен в фоновой сессии Windows (Session 0/5) без доступа к рабочему столу пользователя (Session 1), что делает его невидимым и блокирует сокеты.
- **Решение 2**: Запустить вкладку `http://localhost:3001` в интерактивной сессии пользователя:
  1. Выполнить `whoami` для получения имени пользователя (например, `desktop-xyz\user`).
  2. Зарегистрировать интерактивную задачу: `schtasks /create /tn "OpenBrowserForAgent" /tr "cmd.exe /c start http://localhost:3001" /sc once /st 00:00 /ru <ИМЯ_ПОЛЬЗОВАТЕЛЯ> /it /f`
  3. Запустить задачу: `schtasks /run /tn "OpenBrowserForAgent"`
  4. Удалить задачу: `schtasks /delete /tn "OpenBrowserForAgent" /f`

