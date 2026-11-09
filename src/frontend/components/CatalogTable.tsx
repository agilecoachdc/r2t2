// Éditeur générique d'une liste d'objets typés (une "table" du catalogue
// d'une règle : races, compétences, armes, armures, pouvoirs psy,
// avantages...). Chaque colonne sait lire/écrire son champ sur la ligne via
// get/set plutôt qu'une simple clé — permet de gérer un champ imbriqué
// (ex. attributeBonus.FO pour les races) sans étendre le type de colonne.
// Utilisé par la page d'admin Règles des jeux (src/frontend/pages/admin/GamesRulesets.tsx).

export interface CatalogColumn<T> {
  key: string;
  label: string;
  kind: "text" | "number" | "select";
  options?: string[];
  get: (row: T) => string | number;
  set: (row: T, value: string) => T;
}

export function CatalogTable<T>({
  rows,
  columns,
  onChange,
  emptyRow,
  addLabel = "+ Ajouter une ligne",
}: {
  rows: T[];
  columns: CatalogColumn<T>[];
  onChange: (rows: T[]) => void;
  emptyRow: () => T;
  addLabel?: string;
}) {
  function updateRow(i: number, column: CatalogColumn<T>, value: string) {
    onChange(rows.map((r, idx) => (idx === i ? column.set(r, value) : r)));
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              {columns.map((col) => (
                <th key={col.key} className="px-2 py-1">
                  {col.label}
                </th>
              ))}
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-800">
                {columns.map((col) => (
                  <td key={col.key} className="px-2 py-1">
                    {col.kind === "select" ? (
                      <select
                        value={String(col.get(row))}
                        onChange={(e) => updateRow(i, col, e.target.value)}
                        className="rounded border border-slate-700 bg-slate-800 px-2 py-1"
                      >
                        <option value="" />
                        {col.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={col.kind}
                        value={col.get(row)}
                        onChange={(e) => updateRow(i, col, e.target.value)}
                        className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 ${col.kind === "number" ? "w-20" : "w-full min-w-[10rem]"}`}
                      />
                    )}
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                    className="text-slate-500 hover:text-red-400"
                    aria-label="Supprimer la ligne"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => onChange([...rows, emptyRow()])} className="text-sm text-indigo-400 hover:underline">
        {addLabel}
      </button>
    </div>
  );
}
