# Map source data

Inputs downloaded by `tools/build_map.py`, kept here so the map can be
rebuilt offline and the build is reproducible.

- `t12_*.png` — AWS Terrain Tiles, zoom 12, "terrarium" encoding
  (elevation = R×256 + G + B/256 − 32768 metres). Derived from NASA SRTM for
  this area; public domain / AWS Open Data
  (https://registry.opendata.aws/terrain-tiles/).
- `2011_Dist.*` — Census of India 2011 district boundaries, published by
  DataMeet (https://github.com/datameet/maps), licensed CC BY 2.5 India.
  Credit: "District boundaries: Census of India 2011, DataMeet".
