# Технические стандарты проекта (FSL Architecture)
Соблюдать всегда.

---

## 1. Правила Слоев и Модулей (FSL Architecture)
1. **Размещение кода**: исходный код строго распределяется по FSL-слоям (`src/{layer}/`): `loader/`, `viewer/`, `animation/`, `exporter/`, `store/`, `ui/`, `shared/`.
2. **Слой `shared`**: только общесистемные UI-компоненты (`src/shared/ui`), базовые типы (`src/shared/types`) и параметризованные Canvas/Atlas утилиты (`src/shared/utils`).
3. **Изоляция слоев**:
   - Прямые глубокие импорты внутренних файлов запрещены — строго через публичный контракт модуля (`index.ts`).
   - Чистые/вычислительные слои (`loader`, `animation`, `exporter`) не импортируют React UI компоненты.

---

## 2. React + Three.js (R3F) + TypeScript + Zustand
**TypeScript**:
* Строгий режим, запрет `any`/`as any`.
* `interface` — публичные контракты/пропсы компонентов, `type` — union/вычисления/состояния R3F.
* Promise/FBX Loader/Worker → точные возвращаемые типы.

**UI & Стили**:
* Только функциональные React компоненты.
* Стилизация строго через TailwindCSS.
* Состояние: глобальный стейт через Zustand в слое `src/store/`, локальное UI-состояние через `useState`.

---

## 3. Доменные Best Practices (Three.js / R3F / Canvas Baking)
* **Управление 3D-сценой**: через React Three Fiber (`Canvas`, `useFrame`, `useThree`).
* **Очистка ресурсов (Memory Leak Prevention)**: явный `dispose()` для WebGLRenderTarget, текстур, геометрий и материалов при размонтировании 3D-объектов.
* **Refs в JSX**: запрещено чтение/запись `ref.current` во время рендера JSX → строго `useLayoutEffect` или Callback refs.
* **Именования**:
  - Компоненты, типы, интерфейсы: `PascalCase`.
  - Переменные, хуки, сторы: `camelCase` (`useAnimationStore`).
  - Константы: `SCREAMING_SNAKE_CASE`.
  - Папки, файлы: `kebab-case`.

---

## 4. Тесты
1. **Существующие тесты**: запрещено менять и отключать assertions. Упал тест → чинить код.
2. **Запуск**: строго по предварительному согласованию с пользователем.
3. **Новые тесты**:
   - Изолированное тестирование генератора атласа (PNG packing, JSON metadata) без зависимости от WebGL DOM.
   - Сброс стейта Zustand в `beforeEach`.
   - Мокирование внешних FBX файлов, WebGLRenderTarget и Canvas API.
