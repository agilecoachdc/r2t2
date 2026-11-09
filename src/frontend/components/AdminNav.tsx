// Barre de navigation partagée entre les pages d'admin (Règles des jeux /
// Admin de parties / Comptes) — évite de repasser par l'accueil pour circuler entre
// elles. `current` masque le lien vers la page affichée.

import { Link } from "react-router-dom";

const ITEMS = [
  { key: "jeux", to: "/admin/jeux", label: "Règles des jeux" },
  { key: "groupes", to: "/admin/groupes", label: "Admin de parties" },
  { key: "comptes", to: "/admin/comptes", label: "Comptes" },
] as const;

export function AdminNav({ current }: { current: (typeof ITEMS)[number]["key"] }) {
  return (
    <nav className="flex items-center gap-3 text-sm text-slate-400">
      <Link to="/" className="text-indigo-400 hover:underline">
        ← Accueil
      </Link>
      {ITEMS.filter((item) => item.key !== current).map((item) => (
        <Link key={item.key} to={item.to} className="text-indigo-400 hover:underline">
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
