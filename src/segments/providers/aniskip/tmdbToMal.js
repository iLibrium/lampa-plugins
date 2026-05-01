// Минимальный bundled-mapping TMDB tv id → MAL id для популярных аниме.
// Этот словарь намеренно короткий — пользовательские дополнения подхватываются
// из Lampa.Storage по ключу `autoskip_aniskip_map` (формат: { "<tmdbId>": malId }).
// Расширять основную таблицу стоит через PR.
export const TMDB_TO_MAL = {
  // Attack on Titan / Атака титанов
  1429: 16498,
  // Demon Slayer / Клинок, рассекающий демонов
  85937: 38000,
  // Jujutsu Kaisen / Магическая битва
  95479: 40748,
  // My Hero Academia / Моя геройская академия
  65930: 31964,
  // One Punch Man / Ванпанчмен
  63926: 30276,
  // Death Note / Тетрадь смерти
  13916: 1535,
  // Steins;Gate
  31910: 9253,
  // Code Geass / Код Гиасс
  16245: 1575,
  // Naruto Shippuden / Наруто: Ураганные хроники
  46260: 1735,
  // Bleach: Thousand-Year Blood War
  118646: 41467,
  // Spy x Family
  120089: 50265,
  // Chainsaw Man
  114410: 44511,
  // Re:Zero
  65840: 31240,
  // Mob Psycho 100
  65786: 32182,
  // Vinland Saga
  82684: 37521,
  // Made in Abyss
  72636: 34599,
  // Konosuba
  65754: 30831,
  // Mushoku Tensei
  104134: 39535,
  // Solo Leveling
  127532: 52299,
  // Frieren / Провожающая в последний путь Фрирен
  209867: 52991,
  // Cyberpunk: Edgerunners
  105248: 42310
};
