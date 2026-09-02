#!/usr/bin/env node

// Скрипт для генерации оптимальных правил для Qwen3 Coder 480B

import { execSync } from 'child_process';
import { join } from 'path';
import { readFileSync } from 'fs';

console.log("=== Генерация оптимальных правил для Qwen3 Coder 480B ===\n");

// Получаем список всех принятых правил
const storeScript = join(import.meta.dirname, 'store.js');
const indexContent = readFileSync('/Users/mvschegole/.config/opencode/knowledge/x-tips/INDEX.md', 'utf-8');

console.log("Топ-5 правил по популярности:");

// Парсим INDEX.md и находим топ правила
const lines = indexContent.split('\n');
const ruleLines = lines.filter(line => line.includes('|') && line.includes('adopted'));

// Сортируем по лайкам
const sortedRules = ruleLines
  .map(line => {
    const parts = line.split('|');
    return {
      likes: parseInt(parts[4]),
      text: parts[7].trim(),
      id: parts[6].trim()
    };
  })
  .sort((a, b) => b.likes - a.likes)
  .slice(0, 5);

sortedRules.forEach((rule, index) => {
  console.log(`${index + 1}. [${rule.id}] ${rule.likes} лайков: ${rule.text}`);
});

console.log("\n=== Оптимизированные инструкции для Qwen3 Coder 480B ===\n");

const optimizedInstructions = `
# Оптимизированные инструкции для работы с Qwen3 Coder 480B

## 1. Архитектура взаимодействия
- Используйте /clear между непересекающимися задачами для предотвращения загрязнения контекста
- Для сложных задач разбивайте их на подзадачи и используйте субагентов
- Предоставляйте технический контекст и ограничения заранее

## 2. Паттерны эффективного prompting
- Используйте точную техническую терминологию для максимальной эффективности
- При code review предоставляйте как код, так и бизнес-контекст
- Для архитектурных решений указывайте требования масштабируемости и безопасности

## 3. Рекомендации по кодированию
- При генерации кода всегда указывайте версию языка и фреймворка
- Предпочтение современным паттернам и best practices
- Учитывайте производительность и читаемость кода

## 4. Мета-информация для модели
Модель: Qwen3 Coder 480B
Специализация: Программирование и разработка ПО
Режим: Ассистент разработчика
`;

console.log(optimizedInstructions);

// Сохраняем инструкции в файл
const fs = await import('fs');
fs.writeFileSync('/Users/mvschegole/.config/opencode/qwen3-coder-optimizations.md', optimizedInstructions);

console.log("Инструкции сохранены в: ~/.config/opencode/qwen3-coder-optimizations.md");

console.log("\n=== Рекомендации по применению ===");
console.log("1. Используйте эти инструкции как преамбулу к вашим запросам");
console.log("2. Для сложных задач создавайте агентов с помощью:");
console.log("   node ~/.config/opencode/skills/x-claude-tips/main.js apply r_0005");
console.log("3. Регулярно обновляйте правила через команду:");
console.log("   node ~/.config/opencode/skills/x-claude-tips/main.js fetch 14");
console.log("4. Для поддержания эффективности используйте /clear между задачами");

console.log("\n✅ Готово! Ваши оптимизированные правила для Qwen3 Coder 480B сгенерированы.");