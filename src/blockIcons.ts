// Selected original Lucide 1.17.0 vectors (ISC / inherited Feather MIT).
// Provenance: docs/block-icons.json. Notices: licenses/lucide-block-icons.txt.
// Preserve the 24-unit geometry and 2-unit stroke; scale only the canvas.
const icons: Record<string, {name:string;nodes:[string, Record<string,string>][]}> = {
  "T": {
    "name": "type",
    "nodes": [
      [
        "path",
        {
          "d": "M12 4v16"
        }
      ],
      [
        "path",
        {
          "d": "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"
        }
      ],
      [
        "path",
        {
          "d": "M9 20h6"
        }
      ]
    ]
  },
  "H1": {
    "name": "heading-1",
    "nodes": [
      [
        "path",
        {
          "d": "M4 12h8"
        }
      ],
      [
        "path",
        {
          "d": "M4 18V6"
        }
      ],
      [
        "path",
        {
          "d": "M12 18V6"
        }
      ],
      [
        "path",
        {
          "d": "m17 12 3-2v8"
        }
      ]
    ]
  },
  "H2": {
    "name": "heading-2",
    "nodes": [
      [
        "path",
        {
          "d": "M4 12h8"
        }
      ],
      [
        "path",
        {
          "d": "M4 18V6"
        }
      ],
      [
        "path",
        {
          "d": "M12 18V6"
        }
      ],
      [
        "path",
        {
          "d": "M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"
        }
      ]
    ]
  },
  "H3": {
    "name": "heading-3",
    "nodes": [
      [
        "path",
        {
          "d": "M4 12h8"
        }
      ],
      [
        "path",
        {
          "d": "M4 18V6"
        }
      ],
      [
        "path",
        {
          "d": "M12 18V6"
        }
      ],
      [
        "path",
        {
          "d": "M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"
        }
      ],
      [
        "path",
        {
          "d": "M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"
        }
      ]
    ]
  },
  "H4": {
    "name": "heading-4",
    "nodes": [
      [
        "path",
        {
          "d": "M12 18V6"
        }
      ],
      [
        "path",
        {
          "d": "M17 10v3a1 1 0 0 0 1 1h3"
        }
      ],
      [
        "path",
        {
          "d": "M21 10v8"
        }
      ],
      [
        "path",
        {
          "d": "M4 12h8"
        }
      ],
      [
        "path",
        {
          "d": "M4 18V6"
        }
      ]
    ]
  },
  "H5": {
    "name": "heading-5",
    "nodes": [
      [
        "path",
        {
          "d": "M4 12h8"
        }
      ],
      [
        "path",
        {
          "d": "M4 18V6"
        }
      ],
      [
        "path",
        {
          "d": "M12 18V6"
        }
      ],
      [
        "path",
        {
          "d": "M17 13v-3h4"
        }
      ],
      [
        "path",
        {
          "d": "M17 17.7c.4.2.8.3 1.3.3 1.5 0 2.7-1.1 2.7-2.5S19.8 13 18.3 13H17"
        }
      ]
    ]
  },
  "H6": {
    "name": "heading-6",
    "nodes": [
      [
        "path",
        {
          "d": "M4 12h8"
        }
      ],
      [
        "path",
        {
          "d": "M4 18V6"
        }
      ],
      [
        "path",
        {
          "d": "M12 18V6"
        }
      ],
      [
        "circle",
        {
          "cx": "19",
          "cy": "16",
          "r": "2"
        }
      ],
      [
        "path",
        {
          "d": "M20 10c-2 2-3 3.5-3 6"
        }
      ]
    ]
  },
  "bullet": {
    "name": "list",
    "nodes": [
      [
        "path",
        {
          "d": "M3 5h.01"
        }
      ],
      [
        "path",
        {
          "d": "M3 12h.01"
        }
      ],
      [
        "path",
        {
          "d": "M3 19h.01"
        }
      ],
      [
        "path",
        {
          "d": "M8 5h13"
        }
      ],
      [
        "path",
        {
          "d": "M8 12h13"
        }
      ],
      [
        "path",
        {
          "d": "M8 19h13"
        }
      ]
    ]
  },
  "ordered": {
    "name": "list-ordered",
    "nodes": [
      [
        "path",
        {
          "d": "M11 5h10"
        }
      ],
      [
        "path",
        {
          "d": "M11 12h10"
        }
      ],
      [
        "path",
        {
          "d": "M11 19h10"
        }
      ],
      [
        "path",
        {
          "d": "M4 4h1v5"
        }
      ],
      [
        "path",
        {
          "d": "M4 9h2"
        }
      ],
      [
        "path",
        {
          "d": "M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"
        }
      ]
    ]
  },
  "task": {
    "name": "list-todo",
    "nodes": [
      [
        "path",
        {
          "d": "M13 5h8"
        }
      ],
      [
        "path",
        {
          "d": "M13 12h8"
        }
      ],
      [
        "path",
        {
          "d": "M13 19h8"
        }
      ],
      [
        "path",
        {
          "d": "m3 17 2 2 4-4"
        }
      ],
      [
        "rect",
        {
          "x": "3",
          "y": "4",
          "width": "6",
          "height": "6",
          "rx": "1"
        }
      ]
    ]
  },
  "quote": {
    "name": "quote",
    "nodes": [
      [
        "path",
        {
          "d": "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
        }
      ],
      [
        "path",
        {
          "d": "M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
        }
      ]
    ]
  },
  "code": {
    "name": "square-code",
    "nodes": [
      [
        "path",
        {
          "d": "m10 9-3 3 3 3"
        }
      ],
      [
        "path",
        {
          "d": "m14 15 3-3-3-3"
        }
      ],
      [
        "rect",
        {
          "x": "3",
          "y": "3",
          "width": "18",
          "height": "18",
          "rx": "2"
        }
      ]
    ]
  },
  "source": {
    "name": "file-code-2",
    "nodes": [
      [
        "path",
        {
          "d": "M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35"
        }
      ],
      [
        "path",
        {
          "d": "M14 2v5a1 1 0 0 0 1 1h5"
        }
      ],
      [
        "path",
        {
          "d": "m5 16-3 3 3 3"
        }
      ],
      [
        "path",
        {
          "d": "m9 22 3-3-3-3"
        }
      ]
    ]
  },
  "table": {
    "name": "table-2",
    "nodes": [
      [
        "path",
        {
          "d": "M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"
        }
      ]
    ]
  },
  "divider": {
    "name": "minus",
    "nodes": [
      [
        "path",
        {
          "d": "M5 12h14"
        }
      ]
    ]
  },
  "math": {
    "name": "sigma",
    "nodes": [
      [
        "path",
        {
          "d": "M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"
        }
      ]
    ]
  },
  "mermaid": {
    "name": "workflow",
    "nodes": [
      [
        "rect",
        {
          "width": "8",
          "height": "8",
          "x": "3",
          "y": "3",
          "rx": "2"
        }
      ],
      [
        "path",
        {
          "d": "M7 11v4a2 2 0 0 0 2 2h4"
        }
      ],
      [
        "rect",
        {
          "width": "8",
          "height": "8",
          "x": "13",
          "y": "13",
          "rx": "2"
        }
      ]
    ]
  },
  "graphviz": {
    "name": "network",
    "nodes": [
      [
        "rect",
        {
          "x": "16",
          "y": "16",
          "width": "6",
          "height": "6",
          "rx": "1"
        }
      ],
      [
        "rect",
        {
          "x": "2",
          "y": "16",
          "width": "6",
          "height": "6",
          "rx": "1"
        }
      ],
      [
        "rect",
        {
          "x": "9",
          "y": "2",
          "width": "6",
          "height": "6",
          "rx": "1"
        }
      ],
      [
        "path",
        {
          "d": "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"
        }
      ],
      [
        "path",
        {
          "d": "M12 12V8"
        }
      ]
    ]
  },
  "image": {
    "name": "image",
    "nodes": [
      [
        "rect",
        {
          "width": "18",
          "height": "18",
          "x": "3",
          "y": "3",
          "rx": "2",
          "ry": "2"
        }
      ],
      [
        "circle",
        {
          "cx": "9",
          "cy": "9",
          "r": "2"
        }
      ],
      [
        "path",
        {
          "d": "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
        }
      ]
    ]
  },
  "callout": {
    "name": "message-square-text",
    "nodes": [
      [
        "path",
        {
          "d": "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
        }
      ],
      [
        "path",
        {
          "d": "M7 11h10"
        }
      ],
      [
        "path",
        {
          "d": "M7 15h6"
        }
      ],
      [
        "path",
        {
          "d": "M7 7h8"
        }
      ]
    ]
  },
  "footnote": {
    "name": "asterisk",
    "nodes": [
      [
        "path",
        {
          "d": "M12 6v12"
        }
      ],
      [
        "path",
        {
          "d": "M17.196 9 6.804 15"
        }
      ],
      [
        "path",
        {
          "d": "m6.804 9 10.392 6"
        }
      ]
    ]
  },
  "definition": {
    "name": "list",
    "nodes": [
      [
        "path",
        {
          "d": "M3 5h.01"
        }
      ],
      [
        "path",
        {
          "d": "M3 12h.01"
        }
      ],
      [
        "path",
        {
          "d": "M3 19h.01"
        }
      ],
      [
        "path",
        {
          "d": "M8 5h13"
        }
      ],
      [
        "path",
        {
          "d": "M8 12h13"
        }
      ],
      [
        "path",
        {
          "d": "M8 19h13"
        }
      ]
    ]
  },
  "up": {
    "name": "arrow-up",
    "nodes": [
      [
        "path",
        {
          "d": "m5 12 7-7 7 7"
        }
      ],
      [
        "path",
        {
          "d": "M12 19V5"
        }
      ]
    ]
  },
  "down": {
    "name": "arrow-down",
    "nodes": [
      [
        "path",
        {
          "d": "M12 5v14"
        }
      ],
      [
        "path",
        {
          "d": "m19 12-7 7-7-7"
        }
      ]
    ]
  },
  "plus": {
    "name": "plus",
    "nodes": [
      [
        "path",
        {
          "d": "M5 12h14"
        }
      ],
      [
        "path",
        {
          "d": "M12 5v14"
        }
      ]
    ]
  },
  "check": {
    "name": "check",
    "nodes": [
      [
        "path",
        {
          "d": "M20 6 9 17l-5-5"
        }
      ]
    ]
  },
  "edit": {
    "name": "pencil",
    "nodes": [
      [
        "path",
        {
          "d": "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
        }
      ],
      [
        "path",
        {
          "d": "m15 5 4 4"
        }
      ]
    ]
  }
};

export function blockIcon(key:string):SVGSVGElement {
  const icon=icons[key];
  if(!icon)throw new Error(`Unknown block icon: ${key}`);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  svg.classList.add('tegg-command-glyph');svg.dataset.icon=icon.name;
  for(const [tag,attributes] of icon.nodes){
    const node=document.createElementNS(svg.namespaceURI,tag);
    for(const [name,value] of Object.entries(attributes))node.setAttribute(name,value);
    svg.append(node);
  }
  return svg;
}
