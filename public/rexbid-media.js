(function attachRexBidMedia(root) {
  "use strict";

  function isHttpUrl(value) {
    return typeof value === "string" && /^https:\/\//i.test(value.trim());
  }

  function collectObjects(value, output = []) {
    if (!value || typeof value !== "object" || output.includes(value)) return output;
    output.push(value);
    if (Array.isArray(value)) value.forEach(item => collectObjects(item, output));
    else Object.values(value).forEach(item => collectObjects(item, output));
    return output;
  }

  function score(url, item = {}) {
    if (!isHttpUrl(url)) return -1;
    const value = url.toLowerCase();
    let result = 0;
    if (/original|orig|full|master|source/.test(value)) result += 80;
    if (/hd|high|large|big|hires|highres|1920|2048|2560|3000|4000|4096/.test(value)) result += 60;
    if (/thumb|thumbnail|small|tiny|preview|320x|400x|480x|640x/.test(value)) result -= 70;
    if (item.original) result += 50;
    if (item.hd) result += 45;
    if (item.large) result += 35;
    if (item.big) result += 30;
    if (item.url) result += 10;
    return result;
  }

  function bestUrl(item) {
    if (typeof item === "string") return isHttpUrl(item) ? item : null;
    if (!item || typeof item !== "object") return null;
    const candidates = [item.original, item.originalUrl, item.original_url, item.master, item.full,
      item.fullsize, item.fullSize, item.hd, item.hdUrl, item.hd_url, item.high, item.highres,
      item.high_res, item.large, item.big, item.imageUrl, item.image_url, item.url, item.src, item.href]
      .filter(isHttpUrl);
    candidates.sort((a, b) => score(b, item) - score(a, item));
    return candidates[0] || null;
  }

  function identity(url) {
    if (!url) return "";
    let value = String(url);
    const imageKeys = value.match(/imageKeys=([^&]+)/i);
    if (imageKeys) {
      try { return `iaai:${decodeURIComponent(imageKeys[1])}`; } catch { return `iaai:${imageKeys[1]}`; }
    }
    return value.replace(/[?&](width|height|w|h|size|quality|q|resize|fit|format)=[^&]+/gi, "")
      .replace(/[?&](thumb|thumbnail|small|medium|large|hd)=true/gi, "")
      .replace(/[?&]+$/, "")
      .replace(/([_-])(thumb|thumbnail|small|medium|large|hd)(?=\.[a-z0-9]+$)/i, "");
  }

  function normalizeMedia(value) {
    const found = [];
    const objects = collectObjects(value);

    function addImage(item, pairedThumb) {
      if (!item) return;
      const mediaType = String(item.type || item.mediaType || item.kind || "").toLowerCase();
      if (/video|vr|360|panorama/.test(mediaType)) return;
      const large = bestUrl(item);
      const ownThumb = item && typeof item === "object"
        ? [item.thumb, item.thumbnail, item.thumbnailUrl, item.thumbnail_url, item.small, item.normal, item.medium].find(isHttpUrl)
        : null;
      const thumb = ownThumb || (isHttpUrl(pairedThumb) ? pairedThumb : null) || large;
      if (large || thumb) found.push({type: "image", thumb: thumb || large, large: large || thumb});
    }

    function addArray(items) {
      if (!Array.isArray(items)) return;
      items.forEach(item => {
        if (!item) return;
        const type = String(item.type || item.mediaType || item.kind || "").toLowerCase();
        if (/video|vr|360|panorama/.test(type)) return;
        addImage(item);
      });
    }

    const canonicalMedia = value && !Array.isArray(value) ? value.media : null;
    if (canonicalMedia && Array.isArray(canonicalMedia.items)) {
      // Canonical DTO is authoritative; do not recursively rediscover the same
      // photos from nested representations and count alternate URLs twice.
      canonicalMedia.items.forEach((item, index) => addImage(item, bestUrl(canonicalMedia.thumbs?.[index])));
      if (Array.isArray(canonicalMedia.thumbs) && canonicalMedia.thumbs.length > canonicalMedia.items.length) {
        canonicalMedia.thumbs.slice(canonicalMedia.items.length).forEach(item => addImage(item));
      }
    } else for (const object of objects) {
      for (const key of ["items", "images", "photos", "media", "imageList", "photoList", "imageItems"]) {
        const candidate = object[key];
        if (!candidate) continue;
        if (Array.isArray(candidate)) {
          addArray(candidate);
          continue;
        }
        if (typeof candidate !== "object") continue;

        const primary = candidate.items || candidate.images || candidate.photos;
        const thumbs = candidate.thumbs;
        const hasPairedPrimary = Array.isArray(primary) && Array.isArray(thumbs);
        if (hasPairedPrimary) {
          // Canonical media has parallel full-size and thumbnail arrays. Pair them by
          // position; thumbnails are alternate renditions, not additional photos.
          primary.forEach((item, index) => addImage(item, bestUrl(thumbs[index])));
          if (thumbs.length > primary.length) thumbs.slice(primary.length).forEach(item => addImage(item));
        } else {
          addArray(candidate.items);
          addArray(candidate.images);
          addArray(candidate.photos);
          addArray(candidate.thumbs);
        }
        addArray(candidate.normal);
        addArray(candidate.medium);
        addArray(candidate.large);
        addArray(candidate.big);

        for (const sizes of [hasPairedPrimary ? null : candidate.thumbs, candidate.normal]) {
          if (!Array.isArray(sizes)) continue;
          sizes.forEach((thumb, index) => {
            const full = candidate.original?.[index] || candidate.hd?.[index] || candidate.large?.[index]
              || candidate.big?.[index] || candidate.full?.[index] || thumb;
            addImage({thumb: bestUrl(thumb), large: bestUrl(full), hd: candidate.hd?.[index], original: candidate.original?.[index]});
          });
        }
      }
    }

    const byIdentity = new Map();
    for (const photo of found) {
      const key = identity(photo.large || photo.thumb);
      if (!key) continue;
      const previous = byIdentity.get(key);
      if (!previous || score(photo.large, photo) > score(previous.large, previous)) byIdentity.set(key, photo);
    }
    return Array.from(byIdentity.values());
  }

  const api = Object.freeze({isHttpUrl, normalizeMedia});
  if (root) root.RexBidMedia = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
