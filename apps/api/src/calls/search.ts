const CYRILLIC_UPPER = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
const CYRILLIC_LOWER = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';

export function foldSearch(value: string): string {
  return value.toLocaleLowerCase('ru-RU');
}

export function foldedColumn(expression: string): string {
  return `translate(lower(coalesce(${expression}, '')), '${CYRILLIC_UPPER}', '${CYRILLIC_LOWER}')`;
}

export function likeContains(value: string): string {
  const folded = foldSearch(value).replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${folded}%`;
}
