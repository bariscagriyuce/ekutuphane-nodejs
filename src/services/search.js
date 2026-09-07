// search.js — Türkçe uyumlu arama anahtarı üretimi.
//
// Arşivdeki başlıkların bir kısmı Türkçe ("Şefkat Güneşi"), bir kısmı ASCII'ye
// çevrilmiş ("Sefkat_Gunesi") yazılmış. SQLite'ın LIKE'ı ise yalnızca ASCII
// harfleri büyük/küçük eşleştirir; "ş" ile "Ş" bile eşleşmez.
//
// Çözüm: hem kayıtlar hem arama terimi aynı sadeleştirmeden geçirilir —
// aksanlar kaldırılır, harfler küçültülür, ayırıcılar boşluğa çevrilir.
// Böylece "şefkat güneşi", "Sefkat_Gunesi" ve "SEFKAT GUNESI" aynı anahtara iner.

/**
 * Metni aranabilir sade bir anahtara çevirir.
 * "Şefkat_Güneşi" → "sefkat gunesi"
 */
export function searchKey(value) {
  return String(value ?? '')
    .normalize('NFD')                    // ş → s + çengel, ü → u + iki nokta …
    .replace(/[̀-ͯ]/g, '')     // birleşen aksan işaretlerini at
    .toLowerCase()
    .replace(/ı/g, 'i')                  // noktasız ı ayrışmaz, elle eşle
    .replace(/[^a-z0-9]+/g, ' ')         // ayırıcı ve noktalamayı boşluğa çevir
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Arama ifadesini kelimelere ayırır. Kelimeler sorguda AND'lenir; böylece
 * "gulen tereddutler" gibi yazar + başlık karışımı aramalar da çalışır.
 * Sorgunun büyümemesi için en fazla 6 kelime kullanılır.
 */
export function searchTokens(query) {
  const key = searchKey(query);
  return key ? key.split(' ').slice(0, 6) : [];
}
