---
name: diagnose
description: >
  Протокол диагностики и верификации геометрии, афинных матриц, трансформов и анимационных адаптеров.
  Автоматизирует 4-этапную трассировку данных и финальную валидацию сборки.
---

# Навык `diagnose`: Диагностика и проверка трансформов/анимаций

## 1. Контекст исполнения (Workspace Root)

- Все проверки, компиляция TS и вызовы скриптов выполняются из директории `prj/`.
- Исходный код находится в `prj/src/`. Все изменения файлов выполняются строго в `prj/src/`.

---

## 2. 4-Этапный протокол трассировки трансформов (Transform Data-Flow)

При любых проблемах с геометрией, вращением, масштабированием или записью ключей анимации трассировать 4 слоя последовательно:

1. **Слой 1 (Selection / Transform Handler)**:
   - Проверить, как UI-жест (`onScaleDrag`, `onRotateLive`, `onMove`) вычисляет аффинную матрицу.
   - Убедиться, что `applyTransform(item, matrix)` на плагине или `GeometryAdapter` не теряет масштаб `scaleX`/`scaleY`, угол `angle` или сдвиг `x`/`y`.

2. **Слой 2 (GeometryAdapter / Group Assembly)**:
   - Проверить `getBounds`, `getVertices`, `applyTransform` адаптера геометрии.
   - При работе с группами убедиться, что `applyTransform` извлекает `sx = Math.hypot(a, b)` и `sy = Math.hypot(c, d)` и обновляет `scaleX`/`scaleY` объекта группы.

3. **Слой 3 (AnimationObjectAdapter & SetupCache)**:
   - Проверить `getChannels`: включает ли каналы `scale` (`scaleX`, `scaleY`), `position` (`x`, `y`), `angle`, `pivot`.
   - Проверить `extractProperties`: считывает ли текущий масштаб/положение из `item` или из `item.transformMatrix`.
   - Проверить `applyValue`: обновляет ли `setupCache` и сохраняет ли целевые значения `scaleX`/`scaleY`/`x`/`y` в анимируемом объекте.

4. **Слой 4 (Playback Engine & Rendering Pass)**:
   - `Pass 1`: Оценка индивидуальных каналов `evaluateTrackValue` -> `applyValue`.
   - `Pass 2`: Иерархическая проброска `getParentDeltaMatrix` -> вычисление `parentAnimatedMatrix` и `parentSetupMatrix` с использованием `pivotX/Y` и `scaleX/Y`.

---

## 3. Чек-лист завершения (Mandatory Verification Protocol)

Перед предоставлением ответа о завершении задачи выполнить строго по порядку:

1. **Типизация**: `node node_modules\typescript\bin\tsc -p tsconfig.app.json --noEmit` в папе `prj` (результат: `0 errors`).
2. **Архитектура**: `node .agents/skills/check/arch-check.cjs` в папке `prj`.
3. **Кэш сборщика**: удалить `prj/node_modules/.vite` (если менялись файлы плагинов/адаптеров).
4. **Документирование**: внести запись багов в локальный `TROUBLESHOOTING.md` в папке плагина (в формате `симптом → причина → решение`).
