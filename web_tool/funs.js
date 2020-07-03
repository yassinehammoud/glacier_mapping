import { state, map, backendUrl } from './globals.js';
import dataset from '../conf/dataset.js';
import models from '../conf/models.js';



export function initializeMap() {
  // add svg overlay
  L.svg({clickable:true}).addTo(map)
  const overlay = d3.select(map.getPanes().overlayPane)
  overlay.select('svg')
    .attrs({
      "pointer-events": "auto",
      "id": "mapOverlay"
    });

  map.on("keydown", function(event) {
    if (event.originalEvent.key == "Shift") {
      predictionExtent(event.latlng, "add");
    }
  });

}

function predictionExtent(latlng) {
  let box = L.polygon([[0, 0], [0, 0]], {"id": "predictionBox"});
  box.addTo(map);
  map.addEventListener("mousemove", extentMoved(box));
  map.addEventListener("keydown", removePatch(box));
  map.addEventListener("click", predPatch(box));
}

/*
 * Associate a Listener with an Extent
 *
 * We need a function factory because we need to associate our mousemove with a
 * function that has a single 'event' argument. However, that event needs to
 * refer to a previously instantiated extent / box. So, we return a function
 * that has access to the box in its scope.
 */
function extentMoved(box) {
  return function(event) {
    let box_coords = getPolyAround(event.latlng, 10000);
    box.setLatLngs(box_coords);
  };
}

function removePatch(box) {
  return function(event) {
    if (event.originalEvent.key == "Escape") {
      box.remove();
    }
  };
}

function predPatch(box) {
  return function(event) {
    const coords = box.getBounds();

    $.ajax({
      type: 'POST',
      url: "http://test.westus2.cloudapp.azure.com:8080/predPatch",
      contentType: "application/json",
      crossDomain:'true',
      dataType: "json",
      data: JSON.stringify({
        extent: {
          xmin: coords._southWest.lng,
          xmax: coords._northEast.lng,
          ymin: coords._southWest.lat,
          ymax: coords._northEast.lat,
          crs: 3857
        },
        classes: dataset["classes"],
        models: models["benjamins_unet"]
      }),
      success: function(response){
        displayPred(response);
      }
    });
  };
}

function decode_img(img_str) {
  return "data:image/jpeg;base64," + img_str;
}

function displayPred(data, show_pixel_map=false) {
  let coords = [[data.extent.ymin, data.extent.xmin],
                [data.extent.ymax, data.extent.xmax]];
  if (show_pixel_map) {
    L.imageOverlay(decode_img(data["output_soft"]), coords).addTo(map);
  }
  L.geoJSON(data["y_geo"]).addTo(map);
}

function getPolyAround(latlng, radius){
  // We convert the input lat/lon into the EPSG3857 projection, define our
  // square, then re-convert to lat/lon
  let latlngProjected = L.CRS.EPSG3857.project(latlng),
      x = latlngProjected.x,
      y = latlngProjected.y;

  let top = Math.round(y + radius/2),
      bottom = Math.round(y - radius/2),
      left = Math.round(x - radius/2),
      right = Math.round(x + radius/2);

  // left / right are "x" points while top/bottom are the "y" points
  let topleft = L.CRS.EPSG3857.unproject(L.point(left, top));
  let bottomright = L.CRS.EPSG3857.unproject(L.point(right, bottom));

  return [[topleft.lat, topleft.lng],
          [topleft.lat, bottomright.lng],
          [bottomright.lat, bottomright.lng],
          [bottomright.lat, topleft.lng]];
}


export function addButtons(parent_id) {
  d3.select(parent_id)
    .append("button")
    .text("New Polygon")
    .on("click", newPoly);
}

function newPoly() {
  map.addEventListener("mousemove", nodeReposition);
  map.addEventListener("click", addNode);

  // update the polygon's state
  let poly = state.polygons;
  poly.push([]);
  state.polygons = poly;
  state.focus = poly.length - 1;
  state.mode = "create";
}

function addNode(event) {
  let mousePos = [event.latlng.lat, event.latlng.lng],
      poly = state.polygons;
  poly[state.focus].push(mousePos);
  state.polygons = poly;

  let curPoly = poly[state.focus];
  if (curPoly.length > 2 & dist2(curPoly[0], curPoly[curPoly.length - 1]) < 0.001) {
    curPoly.splice(-2, 2);
    poly[state.focus] = curPoly;
    map.removeEventListener("mousemove", nodeReposition);
    map.removeEventListener("click", addNode);
    state.polygons = poly;
    state.mode = "edit";
    redraw();
  }
}

function nodeReposition(event) {
  let mousePos = [event.latlng.lat, event.latlng.lng],
      poly = state.polygons,
      curPoly = poly[state.focus];

  if (curPoly.length == 0) {
    curPoly.push(mousePos);
  } else if (curPoly.length > 2 & dist2(mousePos, curPoly[0]) < 0.001) {
    curPoly[curPoly.length - 1][0] = curPoly[0][0];
    curPoly[curPoly.length - 1][1] = curPoly[0][1];
  } else {
    curPoly[curPoly.length - 1][0] = mousePos[0];
    curPoly[curPoly.length - 1][1] = mousePos[1];
  }

  poly[state.focus] = curPoly;
  state.polygons = poly;

  redraw();
}

function nodeMove(event) {
  map.dragging.disable();
  let mousePos = [event.latlng.lat, event.latlng.lng],
      curPoly = state.polygons[state.focus];

  let ix = closestNode(curPoly, mousePos);
  curPoly[ix] = mousePos;
  let poly = state.polygons;
  poly[state.focus] = curPoly;
  state.polygons = poly;
  redraw();
}

function nodeDown(event) {
  if (state.mode != "create") {
    map.addEventListener("mousemove", nodeMove)
  }
}

function nodeUp(event) {
  if (state.mode != "create") {
    map.dragging.enable();
    map.removeEventListener("mousemove", this.nodeMove);
  }
}

export function redraw() {
  let curPoly = state.polygons[state.focus];
  let pointPoly = curPoly.map((d) => map.latLngToLayerPoint(new L.LatLng(d[0], d[1])));
  pointPoly = pointPoly.map((d) => [d.x, d.y]);

  // drawing the polygon nodes
  d3.select("#mapOverlay")
    .select("#polygon-" + state.focus)
    .selectAll("circle")
    .data(pointPoly).enter()
    .append("circle")
    .attrs({
      class: "polyNode",
      cx: (d) => d[0],
      cy: (d) => d[1],
    })
    .on("mouseup", nodeUp)
    .on("mousedown", nodeDown);

  d3.select("#mapOverlay")
    .select("#polygon-" + state.focus)
    .selectAll(".polyNode")
    .data(pointPoly)
    .attrs({
      cx: (d) => d[0],
      cy: (d) => d[1]
    });

  d3.select("#mapOverlay")
    .select("#polygon-" + state.focus)
    .selectAll(".polyNode")
    .data(pointPoly).exit()
    .remove();

  // draw the polygon edges
  let line = d3h.line()
      .x((d) => d[0])
      .y((d) => d[1]);

  d3.select("#mapOverlay")
    .select("#polygon-" + state.focus)
    .selectAll(".polyEdge")
    .data([pointPoly]).enter()
    .append("path")
    .attrs({
      "d": line,
      "class": "polyEdge"
    });

  d3.select("#mapOverlay")
    .select("#polygon-" + state.focus)
    .selectAll(".polyEdge")
    .data([pointPoly])
    .attrs({
      "d": line
    });

  d3.select("#mapOverlay")
    .select("#polygon-" + state.focus)
    .selectAll(".polyEdge")
    .data([pointPoly]).exit()
    .remove();
}


function dist2(a, b) {
  return Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2);
}

function closestNode(poly, pos) {
  let ix = 0,
      min_dist = Infinity;

  for (var i = 0; i < poly.length; i++) {
    let dist = dist2(poly[i], pos);
    if (dist < min_dist) {
      min_dist = dist;
      ix = i;
    }
  }
  return ix;
}
