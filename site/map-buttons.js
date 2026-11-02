// 地図のボタン（右下に縦に。上から 方角・現在地・＋・−）。
// 方角：北の向きを示し、押すと北を上に・真上からの見方に戻す
// 現在地：押すと現在地を画面の中ほどに（取れないときは onNoLocation で代わりの場所へ）
class MapButtons {
  constructor({ onNoLocation } = {}) {
    this.onNoLocation = onNoLocation;
  }

  onAdd(map) {
    this.map = map;
    const box = document.createElement("div");
    box.className = "maplibregl-ctrl map-buttons";
    box.innerHTML = `
      <button type="button" class="single compass" aria-label="北を上にする">
        <svg viewBox="0 0 24 24" class="needle" aria-hidden="true">
          <path d="M12 2 L16 12 L12 12 Z" fill="#c0392b"/><path d="M12 2 L8 12 L12 12 Z" fill="#e57368"/>
          <path d="M12 22 L16 12 L12 12 Z" fill="currentColor" opacity="0.55"/><path d="M12 22 L8 12 L12 12 Z" fill="currentColor" opacity="0.35"/>
        </svg>
      </button>
      <button type="button" class="single locate" aria-label="現在地を表示">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
        </svg>
      </button>
      <div class="zoom">
        <button type="button" class="zoom-in" aria-label="拡大">
          <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button type="button" class="zoom-out" aria-label="縮小">
          <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
        </button>
      </div>`;
    const needle = box.querySelector(".needle");
    const turn = () => {
      needle.style.transform = `rotateX(${map.getPitch()}deg) rotate(${-map.getBearing()}deg)`;
    };
    map.on("rotate", turn);
    map.on("pitch", turn);
    box.querySelector(".compass").addEventListener("click", () => map.easeTo({ bearing: 0, pitch: 0 }));
    box.querySelector(".zoom-in").addEventListener("click", () => map.zoomIn());
    box.querySelector(".zoom-out").addEventListener("click", () => map.zoomOut());
    box.querySelector(".locate").addEventListener("click", () => this.locate());
    this.box = box;
    return box;
  }

  onRemove() {
    this.box.remove();
  }

  locate() {
    const fallback = (why) => this.onNoLocation?.(why);
    if (!navigator.geolocation) return fallback("この端末では現在地が使えません");
    navigator.geolocation.getCurrentPosition(
      (pos) => this.map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(this.map.getZoom(), 10) }),
      () => fallback("現在地が取れませんでした"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
}
