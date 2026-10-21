export const DEFAULT_TIMEZONE = 'Europe/Moscow';
export const DEFAULT_MIN_CALL_DURATION_SEC = 180;
export const MANUAL_SOURCE_NAME = 'Ручная загрузка';

export const DEFAULT_STAGES = [
  {
    key: 'opening',
    title: 'Открытие',
    weight: 0.15,
    instruction: 'Начало разговора и установление контакта',
  },
  {
    key: 'needs',
    title: 'Потребность',
    weight: 0.3,
    instruction: 'Выявление ситуации, проблемы и критериев выбора',
  },
  {
    key: 'presentation',
    title: 'Презентация',
    weight: 0.2,
    instruction: 'Конкретность предложения под сказанное клиентом',
  },
  {
    key: 'objections',
    title: 'Возражения',
    weight: 0.2,
    instruction: 'Работа с возражениями, включая стоимость',
  },
  {
    key: 'closing',
    title: 'Закрытие',
    weight: 0.15,
    instruction: 'Зафиксирован ли следующий шаг',
  },
] as const;
