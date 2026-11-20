/**
 * UI text of the JS / CSS tabs and the code editor (0.3). English, Russian
 * and Ukrainian here; the other locales take English until translated.
 */
export interface CodeLabels {
  tabBlueprints: string;
  tabJs: string;
  tabCss: string;
  tabLibraries: string;
  newJs: string;
  newCss: string;
  defaultJsName: string;
  defaultCssName: string;
  emptyJs: string;
  emptyCss: string;
  run: string;
  runNow: string;
  runReady: string;
  runLoad: string;
  /** %s — count */
  codeLines: string;
  syntaxOk: string;
  /** %s — the parser's message */
  syntaxError: string;
  done: string;
  enabled: string;
  targets: string;
  targetPages: string;
  targetLayouts: string;
  targetTemplates: string;
  componentHtml: string;
  componentCss: string;
  params: string;
  addParam: string;
  paramId: string;
  paramLabel: string;
  paramType: string;
  paramDefault: string;
  paramOptions: string;
  styledComponent: string;
  chooseComponent: string;
  noComponentTypes: string;
  componentCodeHint: string;
  pageCodeHint: string;
  cssHint: string;
  /** %s — count */
  cssRules: string;
  /** %s — item name */
  confirmRemoveCode: string;
  codeTitle: string;
  componentContent: string;
  ownHtml: string;
  pagesComponents: string;
  pagesComponentHint: string;
  componentContentAction: string;
  scriptsAndStyles: string;
  /** %s — record name */
  recordCodeTitle: string;
  recordCodeHint: string;
  globalCode: string;
  noRecordCode: string;
  newJsHere: string;
  newCssHere: string;
}

export const codeEn: CodeLabels = {
  tabBlueprints: 'Blueprints',
  tabJs: 'JS',
  tabCss: 'CSS',
  tabLibraries: 'Libraries',
  newJs: 'New JavaScript',
  newCss: 'New styles',
  defaultJsName: 'JavaScript',
  defaultCssName: 'Styles',
  emptyJs: 'No JavaScript yet. Create it with +.',
  emptyCss: 'No styles yet. Create them with +.',
  run: 'Runs',
  runNow: 'Right away',
  runReady: 'When the page is ready',
  runLoad: 'After everything has loaded',
  codeLines: 'lines: %s',
  syntaxOk: 'No syntax errors',
  syntaxError: 'Syntax error: %s',
  done: 'Done',
  enabled: 'On',
  targets: 'Where',
  targetPages: 'Pages',
  targetLayouts: 'Layouts (every page in them)',
  targetTemplates: 'Templates (their entries)',
  componentHtml: 'HTML of a new instance',
  componentCss: 'CSS of the component',
  params: 'Parameters',
  addParam: 'Add parameter',
  paramId: 'Key',
  paramLabel: 'Label',
  paramType: 'Type',
  paramDefault: 'Default',
  paramOptions: 'Options, comma-separated',
  styledComponent: 'Component',
  chooseComponent: 'Choose a component type',
  noComponentTypes: 'No component types yet: create a component blueprint or component JavaScript first.',
  componentCodeHint: 'Runs for each instance: root is its element, params its parameters. Return a function to clean up.',
  pageCodeHint: 'Runs as a function: return stops it, your variables stay inside.',
  cssHint: 'The CSS becomes GrapesJS rules: you can change them in the Style Manager too.',
  cssRules: 'rules: %s',
  confirmRemoveCode: 'Delete "%s"?',
  codeTitle: 'Code',
  componentContent: 'Content of a new instance',
  ownHtml: 'Its own HTML',
  pagesComponents: 'Linked components (pages)',
  pagesComponentHint: 'Edited in Pages, the same in every instance.',
  componentContentAction: 'Content of the component',
  scriptsAndStyles: 'Scripts & styles',
  recordCodeTitle: 'Scripts & styles: %s',
  recordCodeHint: 'Checked: runs on this record (for a layout, on every page in it).',
  globalCode: 'Global (every page)',
  noRecordCode: 'No page scripts or styles yet.',
  newJsHere: 'New JavaScript here',
  newCssHere: 'New styles here',
};

export const codeRu: CodeLabels = {
  tabBlueprints: 'Блюпринты',
  tabJs: 'JS',
  tabCss: 'CSS',
  tabLibraries: 'Библиотеки',
  newJs: 'Новый JavaScript',
  newCss: 'Новые стили',
  defaultJsName: 'JavaScript',
  defaultCssName: 'Стили',
  emptyJs: 'JavaScript пока нет. Создайте его кнопкой +.',
  emptyCss: 'Стилей пока нет. Создайте их кнопкой +.',
  run: 'Запуск',
  runNow: 'Сразу',
  runReady: 'Когда страница готова',
  runLoad: 'После полной загрузки',
  codeLines: 'строк: %s',
  syntaxOk: 'Синтаксических ошибок нет',
  syntaxError: 'Синтаксическая ошибка: %s',
  done: 'Готово',
  enabled: 'Вкл.',
  targets: 'Где',
  targetPages: 'Страницы',
  targetLayouts: 'Лэйауты (все страницы в них)',
  targetTemplates: 'Шаблоны (их записи)',
  componentHtml: 'HTML нового экземпляра',
  componentCss: 'CSS компонента',
  params: 'Параметры',
  addParam: 'Добавить параметр',
  paramId: 'Ключ',
  paramLabel: 'Подпись',
  paramType: 'Тип',
  paramDefault: 'По умолчанию',
  paramOptions: 'Варианты через запятую',
  styledComponent: 'Компонент',
  chooseComponent: 'Выберите тип компонента',
  noComponentTypes: 'Типов компонентов пока нет: сначала создайте компонентный блюпринт или компонентный JavaScript.',
  componentCodeHint: 'Выполняется для каждого экземпляра: root — его элемент, params — параметры. Верните функцию, чтобы убрать за собой.',
  pageCodeHint: 'Выполняется как функция: return её прерывает, ваши переменные остаются внутри.',
  cssHint: 'CSS превращается в правила GrapesJS: их можно менять и в Style Manager.',
  cssRules: 'правил: %s',
  confirmRemoveCode: 'Удалить «%s»?',
  codeTitle: 'Код',
  componentContent: 'Содержимое нового экземпляра',
  ownHtml: 'Свой HTML',
  pagesComponents: 'Связанные компоненты (pages)',
  pagesComponentHint: 'Редактируется в Pages, одинаков во всех экземплярах.',
  componentContentAction: 'Содержимое компонента',
  scriptsAndStyles: 'Скрипты и стили',
  recordCodeTitle: 'Скрипты и стили: %s',
  recordCodeHint: 'Отмечено — работает на этой записи (у лэйаута — на всех его страницах).',
  globalCode: 'Глобальные (на всех страницах)',
  noRecordCode: 'Страничных скриптов и стилей пока нет.',
  newJsHere: 'Новый JavaScript здесь',
  newCssHere: 'Новые стили здесь',
};

export const codeUk: CodeLabels = {
  tabBlueprints: 'Блюпринти',
  tabJs: 'JS',
  tabCss: 'CSS',
  tabLibraries: 'Бібліотеки',
  newJs: 'Новий JavaScript',
  newCss: 'Нові стилі',
  defaultJsName: 'JavaScript',
  defaultCssName: 'Стилі',
  emptyJs: 'JavaScript поки немає. Створіть його кнопкою +.',
  emptyCss: 'Стилів поки немає. Створіть їх кнопкою +.',
  run: 'Запуск',
  runNow: 'Одразу',
  runReady: 'Коли сторінка готова',
  runLoad: 'Після повного завантаження',
  codeLines: 'рядків: %s',
  syntaxOk: 'Синтаксичних помилок немає',
  syntaxError: 'Синтаксична помилка: %s',
  done: 'Готово',
  enabled: 'Увімк.',
  targets: 'Де',
  targetPages: 'Сторінки',
  targetLayouts: 'Лейаути (усі сторінки в них)',
  targetTemplates: 'Шаблони (їхні записи)',
  componentHtml: 'HTML нового екземпляра',
  componentCss: 'CSS компонента',
  params: 'Параметри',
  addParam: 'Додати параметр',
  paramId: 'Ключ',
  paramLabel: 'Підпис',
  paramType: 'Тип',
  paramDefault: 'Типово',
  paramOptions: 'Варіанти через кому',
  styledComponent: 'Компонент',
  chooseComponent: 'Виберіть тип компонента',
  noComponentTypes: 'Типів компонентів поки немає: спершу створіть компонентний блюпринт або компонентний JavaScript.',
  componentCodeHint: 'Виконується для кожного екземпляра: root — його елемент, params — параметри. Поверніть функцію, щоб прибрати за собою.',
  pageCodeHint: 'Виконується як функція: return її перериває, ваші змінні лишаються всередині.',
  cssHint: 'CSS перетворюється на правила GrapesJS: їх можна змінювати й у Style Manager.',
  cssRules: 'правил: %s',
  confirmRemoveCode: 'Видалити «%s»?',
  codeTitle: 'Код',
  componentContent: 'Вміст нового екземпляра',
  ownHtml: 'Власний HTML',
  pagesComponents: 'Пов’язані компоненти (pages)',
  pagesComponentHint: 'Редагується в Pages, однаковий у всіх екземплярах.',
  componentContentAction: 'Вміст компонента',
  scriptsAndStyles: 'Скрипти й стилі',
  recordCodeTitle: 'Скрипти й стилі: %s',
  recordCodeHint: 'Позначено — працює на цьому записі (у лейаута — на всіх його сторінках).',
  globalCode: 'Глобальні (на всіх сторінках)',
  noRecordCode: 'Сторінкових скриптів і стилів поки немає.',
  newJsHere: 'Новий JavaScript тут',
  newCssHere: 'Нові стилі тут',
};
