import * as THREE from 'three';

export function createTextureAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; // 16 columns of 16px wide
    canvas.height = 256; // 16 rows of 16px high
    const ctx = canvas.getContext('2d');

    // Background debug color (magenta = missing texture)
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, 256, 256);

    const drawTile = (col, row, color, detailColor = null, detailType = 'none') => {
        const x = col * 16;
        const y = row * 16;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 16, 16);

        if (detailColor && detailType !== 'none') {
            ctx.fillStyle = detailColor;
            if (detailType === 'noise') {
                for (let i = 0; i < 20; i++) {
                    ctx.fillRect(x + Math.random() * 15, y + Math.random() * 15, 2, 2);
                }
            } else if (detailType === 'border') {
                ctx.strokeRect(x, y, 16, 16);
            } else if (detailType === 'lines') {
                ctx.fillRect(x + 2, y, 2, 16);
                ctx.fillRect(x + 8, y, 2, 16);
                ctx.fillRect(x + 14, y, 2, 16);
            } else if (detailType === 'grass_side') {
                ctx.fillRect(x, y, 16, 4);
            } else if (detailType === 'moss') {
                for (let i = 0; i < 15; i++) {
                    ctx.fillRect(x + Math.random() * 14, y + Math.random() * 14, 3, 3);
                }
            }
        }
    };

    // 1: Dirt [0, 0]
    drawTile(0, 0, '#664422', '#4a3219', 'noise');

    // 2: Grass
    drawTile(1, 0, '#664422', '#41980a', 'grass_side'); // side [1, 0]
    drawTile(1, 1, '#664422', '#4a3219', 'noise'); // bottom [1, 1]
    drawTile(1, 2, '#41980a', '#327a05', 'noise'); // top [1, 2]

    // 3: Stone
    drawTile(2, 0, '#888888', '#666666', 'noise'); // [2, 0]

    // 4: Wood (Oak Log)
    drawTile(3, 0, '#5A3A1D', '#3D2510', 'lines'); // side [3, 0]
    drawTile(3, 1, '#D0A264', '#8a6e45', 'noise'); // top/bottom (rings) [3, 1]

    // 5: Leaves
    drawTile(4, 0, '#266e2c', '#18471c', 'noise'); // [4, 0]

    // 6: Sand
    drawTile(5, 0, '#d2c286', '#bba96b', 'noise'); // [5, 0]

    // 7: Glass
    drawTile(6, 0, 'rgba(200, 220, 255, 0.25)', '#ffffff', 'border'); // [6, 0]

    // 8: Water
    drawTile(7, 0, 'rgba(50, 80, 200, 0.7)'); // [7, 0]

    // 9: Oak Planks
    drawTile(8, 0, '#b88f58', '#997444', 'lines'); // [8, 0]

    // 10: Cobblestone
    drawTile(9, 0, '#757575', '#4d4d4d', 'border'); // [9, 0]

    // 11: Coal Ore
    drawTile(10, 0, '#888888', '#222222', 'noise'); // [10, 0]

    // 12: Iron Ore
    drawTile(11, 0, '#888888', '#e2c0a8', 'noise'); // [11, 0]

    // 13: Gold Ore
    drawTile(12, 0, '#888888', '#fcee4e', 'noise'); // [12, 0]

    // 14: Diamond Ore
    drawTile(13, 0, '#888888', '#4eeffc', 'noise'); // [13, 0]

    // 19. Torch [2, 1]
    {
        const x = 2 * 16, y = 1 * 16;
        ctx.clearRect(x, y, 16, 16);
        // Stick
        ctx.fillStyle = '#5A3A1D';
        ctx.fillRect(x + 7, y + 6, 2, 10);
        ctx.fillStyle = '#3D2510';
        ctx.fillRect(x + 8, y + 6, 1, 10);
        // Flame
        ctx.fillStyle = '#ffaa00';
        ctx.fillRect(x + 6, y + 3, 4, 3);
        ctx.fillStyle = '#ffee00';
        ctx.fillRect(x + 7, y + 4, 2, 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 7, y + 5, 2, 1);
    }

    // 54. Lantern [4, 1]
    {
        const x = 4 * 16, y = 1 * 16;
        ctx.clearRect(x, y, 16, 16);
        // Frame
        ctx.fillStyle = '#222222';
        ctx.fillRect(x + 4, y + 2, 8, 12);
        // Glass Core
        ctx.fillStyle = '#ffeebb';
        ctx.fillRect(x + 5, y + 4, 6, 8);
        ctx.fillStyle = '#ffcc44';
        ctx.fillRect(x + 6, y + 6, 4, 4);
        // Bars
        ctx.fillStyle = '#222222';
        ctx.fillRect(x + 7, y + 4, 2, 8);
        ctx.fillRect(x + 5, y + 7, 6, 2);
    }

    // 55. Cactus Top & Bottom [5, 1], Side [6, 1]
    {
        // Top
        const tx = 5 * 16, ty = 1 * 16;
        ctx.clearRect(tx, ty, 16, 16);
        ctx.fillStyle = '#115511';
        ctx.fillRect(tx, ty, 16, 16);
        ctx.fillStyle = '#e6eedd'; // White dots
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                ctx.fillRect(tx + 2 + i * 4, ty + 2 + j * 4, 1, 1);
            }
        }

        // Side
        const sx = 6 * 16, sy = 1 * 16;
        ctx.clearRect(sx, sy, 16, 16);
        ctx.fillStyle = '#116611';
        ctx.fillRect(sx, sy, 16, 16);
        ctx.fillStyle = '#0a440a';
        ctx.fillRect(sx + 3, sy, 2, 16);
        ctx.fillRect(sx + 11, sy, 2, 16);
        ctx.fillStyle = '#e6eedd'; // Spikes
        for (let i = 0; i < 4; i++) {
            ctx.fillRect(sx + 1, sy + 2 + i * 4, 1, 1);
            ctx.fillRect(sx + 8, sy + 3 + i * 4, 1, 1);
            ctx.fillRect(sx + 14, sy + 1 + i * 4, 1, 1);
        }
    }

    // 40: Snow [14, 0]
    drawTile(14, 0, '#f0f0f0', '#ffffff', 'noise');

    // 41: Bedrock [15, 0]
    drawTile(15, 0, '#333333', '#111111', 'noise');

    // 42: Tall Grass [14, 1] — green blades
    {
        const x = 14 * 16, y = 1 * 16;
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#41980a';
        // Draw grass blade shapes
        ctx.fillRect(x + 3, y + 4, 2, 12);
        ctx.fillRect(x + 7, y + 2, 2, 14);
        ctx.fillRect(x + 11, y + 6, 2, 10);
        ctx.fillStyle = '#327a05';
        ctx.fillRect(x + 5, y + 5, 2, 11);
        ctx.fillRect(x + 9, y + 3, 2, 13);
        ctx.fillRect(x + 13, y + 7, 2, 9);
    }

    // 43: Red Flower [14, 2]
    {
        const x = 14 * 16, y = 2 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#2d7a1c';
        ctx.fillRect(x + 7, y + 8, 2, 8); // stem
        ctx.fillStyle = '#ff3333';
        ctx.fillRect(x + 5, y + 4, 6, 5); // petals
        ctx.fillStyle = '#ffee00';
        ctx.fillRect(x + 7, y + 5, 2, 2); // center
    }

    // 44: Yellow Flower [15, 1]
    {
        const x = 15 * 16, y = 1 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#2d7a1c';
        ctx.fillRect(x + 7, y + 8, 2, 8); // stem
        ctx.fillStyle = '#ffdd00';
        ctx.fillRect(x + 5, y + 4, 6, 5); // petals
        ctx.fillStyle = '#ff8800';
        ctx.fillRect(x + 7, y + 5, 2, 2); // center
    }

    // 45: Raw Porkchop [0, 3]
    {
        const x = 0, y = 3 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#ffaabb';
        ctx.fillRect(x + 2, y + 4, 12, 9); // meat body
        ctx.fillStyle = '#cc4455';
        ctx.fillRect(x + 3, y + 5, 4, 4); // dark meat
        ctx.fillRect(x + 8, y + 6, 4, 3);
        ctx.fillStyle = '#eecc88';
        ctx.fillRect(x + 2, y + 11, 12, 2); // fat strip
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 5, y + 7, 2, 2); // bone
    }

    // 46: Raw Beef [1, 3]
    {
        const x = 1 * 16, y = 3 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#bb3333';
        ctx.fillRect(x + 2, y + 3, 12, 10); // steak body
        ctx.fillStyle = '#992222';
        ctx.fillRect(x + 4, y + 5, 3, 6); // dark sections
        ctx.fillRect(x + 9, y + 4, 4, 5);
        ctx.fillStyle = '#ffcccc';
        ctx.fillRect(x + 3, y + 6, 2, 3); // marbling
        ctx.fillRect(x + 8, y + 7, 2, 2);
    }

    // 47: Bread [2, 3]
    {
        const x = 2 * 16, y = 3 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#d4a04a';
        ctx.fillRect(x + 2, y + 5, 12, 8); // loaf body
        ctx.fillStyle = '#b8842e';
        ctx.fillRect(x + 2, y + 10, 12, 3); // bottom crust
        ctx.fillStyle = '#e8c464';
        ctx.fillRect(x + 3, y + 5, 10, 3); // top highlight
        ctx.fillStyle = '#c09030';
        ctx.fillRect(x + 6, y + 7, 1, 4); // score mark
        ctx.fillRect(x + 9, y + 7, 1, 4);
    }

    // 48. Lava [3, 3]
    drawTile(3, 3, '#ed4c11', '#ffa500', 'noise');

    // 49. Gravel [4, 3]
    drawTile(4, 3, '#737170', '#8c8a88', 'noise');

    // 50. Clay [5, 3]
    drawTile(5, 3, '#a3a7b5', '#b3b7c5', 'noise');

    // 51. Kelp [6, 3]
    {
        const x = 6 * 16, y = 3 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#2d7a1c';
        ctx.fillRect(x + 7, y + 0, 2, 16); // main stalk
        ctx.fillStyle = '#41980a';
        ctx.fillRect(x + 9, y + 2, 2, 4); // leaf
        ctx.fillRect(x + 5, y + 8, 2, 4); // leaf
        ctx.fillRect(x + 9, y + 12, 2, 4); // leaf
    }

    // 52. Lily Pad [7, 3]
    {
        const x = 7 * 16, y = 3 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#216315';
        ctx.beginPath();
        ctx.arc(x + 8, y + 8, 6, 0.2 * Math.PI, 1.8 * Math.PI); // Pacman shape
        ctx.lineTo(x + 8, y + 8);
        ctx.fill();
    }

    // 53. Mossy Cobblestone [8, 3]
    drawTile(8, 3, '#757575', '#4d4d4d', 'border');
    drawTile(8, 3, 'rgba(0,0,0,0)', '#2d7a1c', 'moss');

    // ======== ROW 4 — New Items & Blocks ========

    // 56. Coal [0, 4]
    {
        const x = 0, y = 4 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x + 3, y + 3, 10, 10);
        ctx.fillStyle = '#333333';
        ctx.fillRect(x + 4, y + 4, 4, 3);
        ctx.fillRect(x + 9, y + 7, 3, 4);
        ctx.fillStyle = '#555555';
        ctx.fillRect(x + 5, y + 5, 2, 2); // shine
        ctx.fillStyle = '#111111';
        ctx.fillRect(x + 6, y + 8, 3, 3);
    }

    // 57. Iron Ingot [1, 4]
    {
        const x = 1 * 16, y = 4 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#d4c4b0';
        ctx.fillRect(x + 2, y + 5, 12, 7); // main body
        ctx.fillStyle = '#e8ddd0';
        ctx.fillRect(x + 3, y + 5, 10, 3); // top highlight
        ctx.fillStyle = '#b0a090';
        ctx.fillRect(x + 2, y + 10, 12, 2); // bottom shadow
        ctx.fillStyle = '#c4b4a0';
        ctx.fillRect(x + 4, y + 7, 8, 2); // middle band
    }

    // 58. Gold Ingot [2, 4]
    {
        const x = 2 * 16, y = 4 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#eebb22';
        ctx.fillRect(x + 2, y + 5, 12, 7);
        ctx.fillStyle = '#ffdd44';
        ctx.fillRect(x + 3, y + 5, 10, 3);
        ctx.fillStyle = '#cc9911';
        ctx.fillRect(x + 2, y + 10, 12, 2);
        ctx.fillStyle = '#ddaa22';
        ctx.fillRect(x + 4, y + 7, 8, 2);
    }

    // 59. Diamond [3, 4]
    {
        const x = 3 * 16, y = 4 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#33ddcc';
        // Diamond shape
        ctx.fillRect(x + 6, y + 2, 4, 2);
        ctx.fillRect(x + 4, y + 4, 8, 2);
        ctx.fillRect(x + 3, y + 6, 10, 3);
        ctx.fillRect(x + 4, y + 9, 8, 2);
        ctx.fillRect(x + 6, y + 11, 4, 2);
        // Highlights
        ctx.fillStyle = '#99ffff';
        ctx.fillRect(x + 6, y + 3, 2, 1);
        ctx.fillRect(x + 5, y + 5, 3, 2);
        ctx.fillStyle = '#22aa99';
        ctx.fillRect(x + 8, y + 8, 3, 2);
    }

    // 60. Cooked Porkchop [4, 4]
    {
        const x = 4 * 16, y = 4 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#b87040';
        ctx.fillRect(x + 2, y + 4, 12, 9);
        ctx.fillStyle = '#8b5030';
        ctx.fillRect(x + 3, y + 5, 4, 4);
        ctx.fillRect(x + 8, y + 6, 4, 3);
        ctx.fillStyle = '#d4a060';
        ctx.fillRect(x + 2, y + 11, 12, 2); // crispy edge
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 5, y + 7, 2, 2); // bone
    }

    // 61. Cooked Beef [5, 4]
    {
        const x = 5 * 16, y = 4 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#8b4020';
        ctx.fillRect(x + 2, y + 3, 12, 10);
        ctx.fillStyle = '#6b3018';
        ctx.fillRect(x + 4, y + 5, 3, 6);
        ctx.fillRect(x + 9, y + 4, 4, 5);
        ctx.fillStyle = '#c0a080';
        ctx.fillRect(x + 3, y + 6, 2, 3); // grill marks
        ctx.fillRect(x + 8, y + 7, 2, 2);
    }

    // 62. Bookshelf side [6, 4]
    {
        const x = 6 * 16, y = 4 * 16;
        ctx.fillStyle = '#b88f58';
        ctx.fillRect(x, y, 16, 16); // plank background
        // Shelf dividers
        ctx.fillStyle = '#8a6e45';
        ctx.fillRect(x, y + 5, 16, 1);
        ctx.fillRect(x, y + 10, 16, 1);
        // Books row 1
        ctx.fillStyle = '#cc3333'; ctx.fillRect(x + 1, y + 1, 3, 4);
        ctx.fillStyle = '#3366cc'; ctx.fillRect(x + 4, y + 1, 3, 4);
        ctx.fillStyle = '#33aa33'; ctx.fillRect(x + 7, y + 1, 3, 4);
        ctx.fillStyle = '#cc9933'; ctx.fillRect(x + 10, y + 1, 3, 4);
        ctx.fillStyle = '#9933cc'; ctx.fillRect(x + 13, y + 1, 2, 4);
        // Books row 2
        ctx.fillStyle = '#aa3333'; ctx.fillRect(x + 1, y + 6, 2, 4);
        ctx.fillStyle = '#3388cc'; ctx.fillRect(x + 3, y + 6, 3, 4);
        ctx.fillStyle = '#cc6633'; ctx.fillRect(x + 6, y + 6, 3, 4);
        ctx.fillStyle = '#336633'; ctx.fillRect(x + 9, y + 6, 2, 4);
        ctx.fillStyle = '#cc3366'; ctx.fillRect(x + 11, y + 6, 3, 4);
        ctx.fillStyle = '#333399'; ctx.fillRect(x + 14, y + 6, 1, 4);
        // Books row 3
        ctx.fillStyle = '#996633'; ctx.fillRect(x + 1, y + 11, 3, 4);
        ctx.fillStyle = '#cc3333'; ctx.fillRect(x + 4, y + 11, 2, 4);
        ctx.fillStyle = '#3399cc'; ctx.fillRect(x + 6, y + 11, 3, 4);
        ctx.fillStyle = '#33cc33'; ctx.fillRect(x + 9, y + 11, 3, 4);
        ctx.fillStyle = '#cc33cc'; ctx.fillRect(x + 12, y + 11, 3, 4);
    }

    // 63. TNT side [7, 4]
    {
        const x = 7 * 16, y = 4 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#cc2222';
        ctx.fillRect(x, y, 16, 16);
        // White band
        ctx.fillStyle = '#eeeeee';
        ctx.fillRect(x, y + 5, 16, 6);
        // TNT text
        ctx.fillStyle = '#cc2222';
        ctx.font = 'bold 6px monospace';
        ctx.fillText('TNT', x + 2, y + 10);
        // Top/bottom stripes
        ctx.fillStyle = '#881111';
        ctx.fillRect(x, y, 16, 2);
        ctx.fillRect(x, y + 14, 16, 2);
    }

    // 63. TNT top [8, 4]
    {
        const x = 8 * 16, y = 4 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#cc9933';
        ctx.fillRect(x, y, 16, 16);
        // Fuse hole
        ctx.fillStyle = '#333333';
        ctx.fillRect(x + 7, y + 7, 2, 2);
        // Cross pattern
        ctx.fillStyle = '#aa7722';
        ctx.fillRect(x + 7, y, 2, 16);
        ctx.fillRect(x, y + 7, 16, 2);
    }

    // 64. White Wool [9, 4]
    drawTile(9, 4, '#f0f0f0', '#e0e0e0', 'noise');

    // 65. Red Wool [10, 4]
    drawTile(10, 4, '#cc3333', '#aa2222', 'noise');

    // 66. Blue Wool [11, 4]
    drawTile(11, 4, '#3355cc', '#2244aa', 'noise');

    // 67. Green Wool [12, 4]
    drawTile(12, 4, '#336633', '#225522', 'noise');

    // 68. Yellow Wool [13, 4]
    drawTile(13, 4, '#ddcc33', '#bbaa22', 'noise');

    // 69. Black Wool [14, 4]
    drawTile(14, 4, '#222222', '#111111', 'noise');

    // ======== ROW 11 — Phase 2 Custom Shape Block Textures ========

    // 70. Oak Door [0, 11]
    {
        const x = 0, y = 11 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#b88f58';
        ctx.fillRect(x, y, 16, 16);
        // Panels
        ctx.fillStyle = '#997444';
        ctx.fillRect(x + 2, y + 1, 12, 6);
        ctx.fillRect(x + 2, y + 9, 12, 6);
        // Panel insets
        ctx.fillStyle = '#a08050';
        ctx.fillRect(x + 3, y + 2, 10, 4);
        ctx.fillRect(x + 3, y + 10, 10, 4);
        // Handle
        ctx.fillStyle = '#444444';
        ctx.fillRect(x + 12, y + 8, 2, 2);
        // Hinges
        ctx.fillStyle = '#555555';
        ctx.fillRect(x + 1, y + 3, 1, 2);
        ctx.fillRect(x + 1, y + 11, 1, 2);
    }

    // 71. Fence [1, 11]
    {
        const x = 1 * 16, y = 11 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#b88f58';
        // Center post
        ctx.fillRect(x + 6, y, 4, 16);
        // Horizontal rails
        ctx.fillStyle = '#997444';
        ctx.fillRect(x + 0, y + 4, 16, 2);
        ctx.fillRect(x + 0, y + 10, 16, 2);
        // Post detail
        ctx.fillStyle = '#a08050';
        ctx.fillRect(x + 7, y + 1, 2, 14);
    }

    // 72. Ladder [2, 11]
    {
        const x = 2 * 16, y = 11 * 16;
        ctx.clearRect(x, y, 16, 16);
        // Side rails
        ctx.fillStyle = '#8b6f3a';
        ctx.fillRect(x + 2, y, 2, 16);
        ctx.fillRect(x + 12, y, 2, 16);
        // Rungs
        ctx.fillStyle = '#a08050';
        ctx.fillRect(x + 2, y + 2, 12, 2);
        ctx.fillRect(x + 2, y + 7, 12, 2);
        ctx.fillRect(x + 2, y + 12, 12, 2);
    }

    // 73. Sign [3, 11]
    {
        const x = 3 * 16, y = 11 * 16;
        ctx.clearRect(x, y, 16, 16);
        // Board
        ctx.fillStyle = '#c8a860';
        ctx.fillRect(x + 1, y + 2, 14, 8);
        // Border
        ctx.fillStyle = '#8b6f3a';
        ctx.strokeStyle = '#8b6f3a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1, y + 2, 14, 8);
        // Post
        ctx.fillStyle = '#8b6f3a';
        ctx.fillRect(x + 7, y + 10, 2, 6);
    }

    // 74. Trapdoor [4, 11]
    {
        const x = 4 * 16, y = 11 * 16;
        ctx.clearRect(x, y, 16, 16);
        ctx.fillStyle = '#b88f58';
        ctx.fillRect(x, y, 16, 16);
        // Grid pattern
        ctx.fillStyle = '#997444';
        ctx.fillRect(x, y + 7, 16, 2);
        ctx.fillRect(x + 7, y, 2, 16);
        // Corner bolts
        ctx.fillStyle = '#555555';
        ctx.fillRect(x + 1, y + 1, 1, 1);
        ctx.fillRect(x + 14, y + 1, 1, 1);
        ctx.fillRect(x + 1, y + 14, 1, 1);
        ctx.fillRect(x + 14, y + 14, 1, 1);
    }

    // 75. Bed Top [5, 11]
    {
        const x = 5 * 16, y = 11 * 16;
        ctx.clearRect(x, y, 16, 16);
        // Red blanket
        ctx.fillStyle = '#cc3333';
        ctx.fillRect(x, y, 16, 12);
        // Pillow
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(x + 2, y + 1, 12, 4);
        ctx.fillStyle = '#ddd';
        ctx.fillRect(x + 3, y + 2, 10, 2);
        // Red blanket folds
        ctx.fillStyle = '#aa2222';
        ctx.fillRect(x + 2, y + 7, 12, 1);
        // Wood frame bottom
        ctx.fillStyle = '#8b6f3a';
        ctx.fillRect(x, y + 12, 16, 4);
    }

    // 76. Bed Side [6, 11]
    {
        const x = 6 * 16, y = 11 * 16;
        ctx.clearRect(x, y, 16, 16);
        // Wood side
        ctx.fillStyle = '#8b6f3a';
        ctx.fillRect(x, y + 8, 16, 8);
        // Red blanket side
        ctx.fillStyle = '#cc3333';
        ctx.fillRect(x, y, 16, 8);
        // Blanket edge
        ctx.fillStyle = '#aa2222';
        ctx.fillRect(x, y + 6, 16, 2);
        // Wood frame detail
        ctx.fillStyle = '#6b5020';
        ctx.fillRect(x, y + 14, 16, 2);
    }


    for (let stage = 0; stage < 10; stage++) {
        const x = stage * 16, y = 5 * 16;
        ctx.clearRect(x, y, 16, 16);
        // More cracks as stage increases
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1;
        const numCracks = 1 + stage * 2;
        for (let c = 0; c < numCracks; c++) {
            ctx.beginPath();
            ctx.moveTo(x + Math.random() * 16, y + Math.random() * 16);
            ctx.lineTo(x + Math.random() * 16, y + Math.random() * 16);
            if (stage > 3) ctx.lineTo(x + Math.random() * 16, y + Math.random() * 16);
            if (stage > 6) ctx.lineTo(x + Math.random() * 16, y + Math.random() * 16);
            ctx.stroke();
        }
        // Darken whole tile as damage increases
        ctx.fillStyle = `rgba(0,0,0,${stage * 0.04})`;
        ctx.fillRect(x, y, 16, 16);
    }

    // --- Tools (Rows 6 to 10) ---
    const drawTool = (type, materialColor, materialHighlight, x, y) => {
        ctx.clearRect(x, y, 16, 16);
        // Common stick
        ctx.fillStyle = '#654b28';

        if (type !== 'sword') {
            for (let i = 14; i >= 6; i--) { ctx.fillRect(x + i, y + i, 1, 1); ctx.fillRect(x + i - 1, y + i, 1, 1); }
        } else {
            for (let i = 14; i >= 10; i--) { ctx.fillRect(x + i, y + i, 1, 1); ctx.fillRect(x + i - 1, y + i, 1, 1); }
            // Guard
            ctx.fillStyle = '#44331a';
            ctx.fillRect(x + 8, y + 10, 3, 1); ctx.fillRect(x + 10, y + 8, 1, 3);
        }

        ctx.fillStyle = materialColor;
        const h = materialHighlight;

        if (type === 'pickaxe') {
            ctx.fillRect(x + 2, y + 2, 8, 2); ctx.fillRect(x + 2, y + 2, 2, 8);
            ctx.fillRect(x + 3, y + 3, 6, 2); ctx.fillRect(x + 3, y + 3, 2, 6);
            ctx.fillStyle = h; ctx.fillRect(x + 1, y + 1, 9, 1); ctx.fillRect(x + 1, y + 1, 1, 9);
        } else if (type === 'axe') {
            ctx.fillRect(x + 3, y + 2, 5, 4); ctx.fillRect(x + 2, y + 3, 6, 4);
            ctx.fillStyle = h; ctx.fillRect(x + 2, y + 2, 6, 1); ctx.fillRect(x + 2, y + 2, 1, 6);
        } else if (type === 'shovel') {
            ctx.fillRect(x + 3, y + 3, 4, 4);
            ctx.fillStyle = h; ctx.fillRect(x + 2, y + 2, 4, 1); ctx.fillRect(x + 2, y + 2, 1, 4);
        } else if (type === 'sword') {
            for (let i = 9; i >= 2; i--) { ctx.fillRect(x + i, y + i, 2, 2); }
            ctx.fillRect(x + 2, y + 1, 8, 1); ctx.fillRect(x + 1, y + 2, 1, 8);
            ctx.fillStyle = h;
            for (let i = 9; i >= 1; i--) { ctx.fillRect(x + i, y + i, 1, 1); }
        }
    };

    const toolMaterials = [
        { name: 'WOOD', color: '#886644', highlight: '#aa8866', row: 6 },
        { name: 'STONE', color: '#888888', highlight: '#aaaaaa', row: 7 },
        { name: 'IRON', color: '#e2c0a8', highlight: '#ffffff', row: 8 },
        { name: 'GOLD', color: '#eebb22', highlight: '#ffee55', row: 9 },
        { name: 'DIAMOND', color: '#33eedd', highlight: '#99ffff', row: 10 }
    ];

    const toolTypes = ['pickaxe', 'axe', 'shovel', 'sword'];

    toolMaterials.forEach((mat) => {
        toolTypes.forEach((type, col) => {
            drawTool(type, mat.color, mat.highlight, col * 16, mat.row * 16);
        });
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;

    return {
        texture,
        dataURL: canvas.toDataURL()
    };
}
