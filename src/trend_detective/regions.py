"""預設區域（母票 #4「預設地點與區域」），以及轉成 GeoJSON 的方法。"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Region:
    id: str
    name_zh: str
    name_en: str
    # W, S, E, N（十進位度）
    bbox: tuple[float, float, float, float]


DEFAULT_REGIONS: tuple[Region, ...] = (
    Region("taiwan", "臺灣", "Taiwan", (120.0, 21.8, 122.1, 25.4)),
    Region("north", "北部", "Northern Taiwan", (121.0, 24.6, 122.1, 25.4)),
    Region("central", "中部", "Central Taiwan", (120.2, 23.5, 121.3, 24.6)),
    Region("south", "南部", "Southern Taiwan", (120.0, 21.8, 121.0, 23.5)),
    Region("east", "東部", "Eastern Taiwan", (121.0, 22.3, 121.8, 24.6)),
)


def regions_feature_collection(regions: tuple[Region, ...]) -> dict[str, Any]:
    """每個區域一個 feature，`properties.id` 是區域 id，外環首尾相接。"""
    features = []
    for region in regions:
        w, s, e, n = region.bbox
        features.append(
            {
                "type": "Feature",
                "properties": {"id": region.id},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}
