# Шаблон project-rules.md

# Технические стандарты проекта
Соблюдать всегда.

---

## 1. Правила Архитектуры и Слоев ({{ARCHITECTURE_PATTERN_NAME}})
{{ARCHITECTURE_LAYER_RULES}}

---

## 2. {{FRAMEWORK_AND_LANG_SECTION}}
**TypeScript**:
* Строгий режим, !`any`/`as any`.
* `interface` — API/пропсы, `type` — union/вычисления.
* Promise/Worker → точные возвращаемые типы.

**UI & Стили**:
* Только функциональные компоненты.
* {{STYLING_RULES}}

**Линтер & Конвенции**:
* Unused vars: удалять (!префикс `_`).
* Ref: `ref.current` in JSX запрещен → `useLayoutEffect` | Callback.

**Именования**:
* Компоненты, типы: `PascalCase`.
* Переменные, хуки: `camelCase`.
* Константы: `SCREAMING_SNAKE_CASE`.
* Папки, файлы: `kebab-case`.

---

## 3. Доменные Best Practices стека
{{PROJECT_SPECIFIC_BEST_PRACTICES}}

---

## 4. Тесты
1. **Существующие тесты**: !менять, !трогать assertions. Тест упал → чинить код.
2. **Запуск**: строго по согласованию с юзером.
3. **Новые тесты**:
   - Сброс стейта: в `beforeEach`.
   - !Сайд-эффекты: мокать сеть, время.
