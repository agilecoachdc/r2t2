// Utilitaire image partagé — upload de portrait (fiche personnage,
// formulaire de création de PNJ).

/**
 * Redimensionne + compresse une image choisie par l'utilisateur en JPEG
 * data URL, avant de la stocker dans `portraitUrl`. Le portrait vit dans le
 * JSON `data` du personnage (colonne D1 unique) — pas de bucket R2 dans ce
 * MVP — donc on plafonne à 480px, et on redescend la qualité JPEG par
 * paliers jusqu'à tenir sous `maxBytes` plutôt que de fixer une qualité
 * fixe : une image très détaillée compresse mal à qualité 0.82 (constaté en
 * prod sur un portrait à 84 Ko réels malgré le plafond 480px — incident du
 * 2026-09-19, GET /api/characters, appelé chaque seconde par l'écran "Suivi
 * des constantes", qui renvoie tous les portraits du groupe et a dépassé la
 * limite CPU du Worker faute de ce plafond). `maxBytes` borne la longueur du
 * data URL (proche des octets réels à l'encodage base64 près, qui gonfle
 * d'~1/3 — marge de sécurité bienvenue ici).
 */
export function resizePortraitToDataUrl(file: File, maxDim = 480, maxBytes = 40_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Fichier image invalide"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Traitement d'image indisponible"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        for (const quality of [0.7, 0.6, 0.5, 0.4, 0.3]) {
          if (dataUrl.length <= maxBytes) break;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(dataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
