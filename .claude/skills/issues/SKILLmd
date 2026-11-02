---
name: issues
description: Создаю github issues и milestones из файла плана. Использую, когда есть готовый план с фазами, и нужно создать бэклог на github.
---

# Plan generator

Прочитай план из $ARGUMENTS
Для каждой фазы создай milestones и issues на GitHub, использую gh CLI

## Поядок действий

1. Прочитай файл плана
2. Для каждой фазы создай milestone:
   `gh api repos/{owner}/{repo}/milestones --field title="Фаза N: название"`
3. Для каждой задачи в фазе создай issue:
   `gh issue create ...`

## Формат Issue:

**Title** — заголовок задачи (текст из плана, без маркеров списка);
**Body** — описание задачи;
