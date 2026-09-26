// 詳細シートを開く操作の受け口。sheets.js が起動時に中身を登録する。
// （部品 → シート → 部品 の循環 import を避けるため）
export const actions = {
  openPlayer: (_name, _opts) => {},
  openTeam: (_team) => {},
  openMatch: (_match) => {},
  openFavPicker: () => {},
};
