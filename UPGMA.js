"use strict";

// This function implements the iterative step of the UPGMA algorithm as
// described at https://en.wikipedia.org/wiki/UPGMA
const UPGMA = (params) => {

    // some checks on the input parameters
    try {
        if (
                // 'labels' and 'distances' are defined
                !params.labels ||
                !params.distances ||
                // the dimensions are consistent
                params.labels.length !== params.distances.length ||
                !params.distances.every(row => row.length === params.labels.length) ||
                // the dimensions are numeric
                !params.distances.every(row => row.every(value => !isNaN(parseFloat(value)) && isFinite(value))) ||
                // the dimensions are simmetric
                (() => { let ok = true;
                         for(let x = 0; (x < params.distances.length) && ok; x++)
                             for(let y = 0; (y < params.distances.length) && ok; y ++)
                                 ok = (params.distances[x][y] === params.distances[y][x]);
                       })()
            ) throw new Error();
    } catch(e) {
        throw new Error("The input parameters to the UPGMA algorithm are inconsistent or invalid.");
    }

    let labels = JSON.parse(JSON.stringify(params.labels)),
        distances = JSON.parse(JSON.stringify(params.distances));

    // makes the labels into arrays, if they aren't already
    labels = labels.map(label => [ ].concat(label));

    // find the minimum and its location
    let minimum = null;
    for (let row = 1; row < distances.length; row++)
        for (let column = 0; column < row; column++)
            if (!minimum || distances[minimum.x][minimum.y] > distances[row][column]) minimum = { "x": row, "y": column }

    // prepares the matrix for the next iteration, so that the aggregated
    // labels are in the first position
    let newLabels = JSON.parse(JSON.stringify(labels)),
        newDistances = JSON.parse(JSON.stringify(distances));
    // remove the aggregated elements from the labels
    newLabels.splice(Math.max(minimum.x, minimum.y), 1);
    newLabels.splice(Math.min(minimum.x, minimum.y), 1);
    // prepend the aggregated labels
    newLabels = [ ].concat([ labels[minimum.x].concat(labels[minimum.y]).sort() ], newLabels);
    // remove the aggregated elements from the distances
    newDistances.splice(Math.max(minimum.x, minimum.y), 1);
    newDistances.splice(Math.min(minimum.x, minimum.y), 1);
    newDistances = newDistances.map(row => {
        row.splice(Math.max(minimum.x, minimum.y), 1);
        row.splice(Math.min(minimum.x, minimum.y), 1);
        return row;
    });
    // add to the distances an empty leftmost column
    newDistances = newDistances.map(row => [ 0 ].concat(row));
    // add a empty top row, too
    newDistances = [ (new Array(newDistances[0].length)).fill(0) ].concat(newDistances);

    // creates a quick reference table to the positions in the old distances
    let oldIndeces = [ ];
    for(let i = 0; i < distances[0].length; i++) oldIndeces[i] = i;
    oldIndeces.splice(Math.max(minimum.x, minimum.y), 1);
    oldIndeces.splice(Math.min(minimum.x, minimum.y), 1);

    // calculates the new distances
    for(let row = 1; row < newDistances.length; row++) {
        newDistances[row][0] = (
            labels[minimum.x].length * distances[minimum.x][oldIndeces[row - 1]] +
            labels[minimum.y].length * distances[minimum.y][oldIndeces[row - 1]]
        ) / (labels[minimum.x].length + labels[minimum.y].length);
        newDistances[0][row] = newDistances[row][0];
    }

    return({ "labels": newLabels, "distances": newDistances });
}

let round1 = UPGMA({
    "labels": [ "a", "b", "c", "d", "e" ],
    "distances": [
        [ 0, 17, 21, 31, 23 ],
        [ 17, 0, 30, 34, 21 ],
        [ 21, 30, 0, 28, 39 ],
        [ 31, 34, 28, 0, 43 ],
        [ 23, 21, 39, 43, 0]
    ]
});
let round2 = UPGMA(round1);
let round3 = UPGMA(round2);
console.log(round3);
