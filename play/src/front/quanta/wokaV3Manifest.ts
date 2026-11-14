// quanta: written by the woka art generator (wokas-v3/export.py) beside the sheets; not edited by hand.
export interface WokaV3ManifestOption {
    id: string;
    label: string;
    group?: string;
    swatch?: string;
    bold?: boolean;
}

export interface WokaV3Manifest {
    version: number;
    layers: {
        key: string;
        part: string;
        label: string;
        optional: boolean;
        styles: WokaV3ManifestOption[];
        colours: WokaV3ManifestOption[];
        texture: string;
        url: string;
    }[];
    presets: Record<string, string[]>;
}

export const WOKA_V3_MANIFEST: WokaV3Manifest = {
    "version": 3,
    "layers": [
        {
            "key": "quantaSkin",
            "part": "skin",
            "label": "Skin",
            "optional": false,
            "styles": [
                {
                    "id": "skin",
                    "label": "Skin"
                }
            ],
            "colours": [
                {
                    "id": "porcelain",
                    "label": "Porcelain",
                    "swatch": "#fbe1cc"
                },
                {
                    "id": "fair",
                    "label": "Fair",
                    "swatch": "#f9d6b4"
                },
                {
                    "id": "light",
                    "label": "Light",
                    "swatch": "#f3c99f"
                },
                {
                    "id": "warm",
                    "label": "Warm",
                    "swatch": "#e8b886"
                },
                {
                    "id": "olive",
                    "label": "Olive",
                    "swatch": "#d9ab78"
                },
                {
                    "id": "tan",
                    "label": "Tan",
                    "swatch": "#c99362"
                },
                {
                    "id": "bronze",
                    "label": "Bronze",
                    "swatch": "#b07a4f"
                },
                {
                    "id": "brown",
                    "label": "Brown",
                    "swatch": "#93613e"
                },
                {
                    "id": "deep",
                    "label": "Deep",
                    "swatch": "#764c31"
                },
                {
                    "id": "ebony",
                    "label": "Ebony",
                    "swatch": "#5c3c2a"
                }
            ],
            "texture": "q3-skin-{colour}",
            "url": "resources/characters/quanta-v3/skin/{colour}.png"
        },
        {
            "key": "quantaEyes",
            "part": "eyes",
            "label": "Eyes",
            "optional": false,
            "styles": [
                {
                    "id": "classic",
                    "label": "Classic"
                },
                {
                    "id": "lashes",
                    "label": "Lashes"
                },
                {
                    "id": "bright",
                    "label": "Bright"
                },
                {
                    "id": "soft",
                    "label": "Soft"
                },
                {
                    "id": "keen",
                    "label": "Keen"
                },
                {
                    "id": "gentle",
                    "label": "Gentle"
                }
            ],
            "colours": [
                {
                    "id": "dark",
                    "label": "Dark brown",
                    "swatch": "#3e2a22"
                },
                {
                    "id": "brown",
                    "label": "Brown",
                    "swatch": "#6e3f22"
                },
                {
                    "id": "hazel",
                    "label": "Hazel",
                    "swatch": "#7a5a26"
                },
                {
                    "id": "amber",
                    "label": "Amber",
                    "swatch": "#a8661e"
                },
                {
                    "id": "green",
                    "label": "Green",
                    "swatch": "#33774a"
                },
                {
                    "id": "blue",
                    "label": "Blue",
                    "swatch": "#3466b4"
                },
                {
                    "id": "grey",
                    "label": "Grey",
                    "swatch": "#5d6e80"
                },
                {
                    "id": "violet",
                    "label": "Violet",
                    "swatch": "#6a48b0",
                    "bold": true
                }
            ],
            "texture": "q3-eyes-{style}-{colour}",
            "url": "resources/characters/quanta-v3/eyes/{style}-{colour}.png"
        },
        {
            "key": "quantaShoes",
            "part": "shoes",
            "label": "Shoes",
            "optional": false,
            "styles": [
                {
                    "id": "sneakers",
                    "label": "Sneakers"
                },
                {
                    "id": "boots",
                    "label": "Boots"
                },
                {
                    "id": "flats",
                    "label": "Flats"
                }
            ],
            "colours": [
                {
                    "id": "white",
                    "label": "White",
                    "swatch": "#e6e3db"
                },
                {
                    "id": "black",
                    "label": "Black",
                    "swatch": "#2b2b32"
                },
                {
                    "id": "grey",
                    "label": "Grey",
                    "swatch": "#959aa5"
                },
                {
                    "id": "brown",
                    "label": "Brown",
                    "swatch": "#7c5233"
                },
                {
                    "id": "red",
                    "label": "Red",
                    "swatch": "#c9443d",
                    "bold": true
                },
                {
                    "id": "navy",
                    "label": "Navy",
                    "swatch": "#30437a",
                    "bold": true
                },
                {
                    "id": "green",
                    "label": "Green",
                    "swatch": "#3f8a58",
                    "bold": true
                },
                {
                    "id": "pink",
                    "label": "Pink",
                    "swatch": "#e98aa9",
                    "bold": true
                }
            ],
            "texture": "q3-shoes-{style}-{colour}",
            "url": "resources/characters/quanta-v3/shoes/{style}-{colour}.png"
        },
        {
            "key": "quantaBottoms",
            "part": "bottoms",
            "label": "Bottoms",
            "optional": false,
            "styles": [
                {
                    "id": "trousers",
                    "label": "Trousers"
                },
                {
                    "id": "joggers",
                    "label": "Joggers"
                },
                {
                    "id": "shorts",
                    "label": "Shorts"
                },
                {
                    "id": "skirt",
                    "label": "Skirt"
                }
            ],
            "colours": [
                {
                    "id": "denim",
                    "label": "Denim",
                    "swatch": "#4b6b97"
                },
                {
                    "id": "darkdenim",
                    "label": "Dark denim",
                    "swatch": "#30425f"
                },
                {
                    "id": "lightdenim",
                    "label": "Light denim",
                    "swatch": "#82a3ca"
                },
                {
                    "id": "black",
                    "label": "Black",
                    "swatch": "#2d2e36"
                },
                {
                    "id": "grey",
                    "label": "Grey",
                    "swatch": "#8b8f9a"
                },
                {
                    "id": "khaki",
                    "label": "Khaki",
                    "swatch": "#c6ae83"
                },
                {
                    "id": "brown",
                    "label": "Brown",
                    "swatch": "#7b5739",
                    "bold": true
                },
                {
                    "id": "navy",
                    "label": "Navy",
                    "swatch": "#2e3c5c"
                },
                {
                    "id": "olive",
                    "label": "Olive",
                    "swatch": "#606b3b",
                    "bold": true
                },
                {
                    "id": "burgundy",
                    "label": "Burgundy",
                    "swatch": "#7e3040",
                    "bold": true
                }
            ],
            "texture": "q3-bottoms-{style}-{colour}",
            "url": "resources/characters/quanta-v3/bottoms/{style}-{colour}.png"
        },
        {
            "key": "quantaTop",
            "part": "top",
            "label": "Top",
            "optional": false,
            "styles": [
                {
                    "id": "tee",
                    "label": "T-shirt"
                },
                {
                    "id": "stripes",
                    "label": "Striped tee"
                },
                {
                    "id": "polo",
                    "label": "Polo"
                },
                {
                    "id": "hoodie",
                    "label": "Hoodie"
                },
                {
                    "id": "sweater",
                    "label": "Sweater"
                },
                {
                    "id": "shirt",
                    "label": "Shirt"
                },
                {
                    "id": "jacket",
                    "label": "Jacket"
                }
            ],
            "colours": [
                {
                    "id": "navy",
                    "label": "Navy",
                    "swatch": "#2d4170"
                },
                {
                    "id": "royal",
                    "label": "Blue",
                    "swatch": "#3366bb"
                },
                {
                    "id": "sky",
                    "label": "Sky",
                    "swatch": "#6cb0e2"
                },
                {
                    "id": "teal",
                    "label": "Teal",
                    "swatch": "#2a8f8b"
                },
                {
                    "id": "green",
                    "label": "Green",
                    "swatch": "#3f9b58"
                },
                {
                    "id": "olive",
                    "label": "Olive",
                    "swatch": "#737c3c"
                },
                {
                    "id": "mustard",
                    "label": "Mustard",
                    "swatch": "#dba63a"
                },
                {
                    "id": "orange",
                    "label": "Orange",
                    "swatch": "#e27b35"
                },
                {
                    "id": "red",
                    "label": "Red",
                    "swatch": "#c9443d"
                },
                {
                    "id": "burgundy",
                    "label": "Burgundy",
                    "swatch": "#8c2f46"
                },
                {
                    "id": "pink",
                    "label": "Pink",
                    "swatch": "#e98aa9"
                },
                {
                    "id": "lavender",
                    "label": "Lavender",
                    "swatch": "#a28cd2"
                },
                {
                    "id": "white",
                    "label": "White",
                    "swatch": "#ebe8e0"
                },
                {
                    "id": "charcoal",
                    "label": "Charcoal",
                    "swatch": "#3f424d"
                }
            ],
            "texture": "q3-top-{style}-{colour}",
            "url": "resources/characters/quanta-v3/top/{style}-{colour}.png"
        },
        {
            "key": "quantaHair",
            "part": "hair",
            "label": "Hair",
            "optional": false,
            "styles": [
                {
                    "id": "crop",
                    "label": "Crop",
                    "group": "short"
                },
                {
                    "id": "cropfade",
                    "label": "Crop fade",
                    "group": "short"
                },
                {
                    "id": "spiky",
                    "label": "Spiky",
                    "group": "short"
                },
                {
                    "id": "swept",
                    "label": "Swept",
                    "group": "short"
                },
                {
                    "id": "sidepart",
                    "label": "Side part",
                    "group": "short"
                },
                {
                    "id": "quiff",
                    "label": "Quiff",
                    "group": "short"
                },
                {
                    "id": "slickback",
                    "label": "Slick back",
                    "group": "short"
                },
                {
                    "id": "buzz",
                    "label": "Buzz cut",
                    "group": "short"
                },
                {
                    "id": "cornrows",
                    "label": "Cornrows",
                    "group": "short"
                },
                {
                    "id": "curls",
                    "label": "Curls",
                    "group": "short"
                },
                {
                    "id": "curlytop",
                    "label": "Curly top",
                    "group": "short"
                },
                {
                    "id": "twists",
                    "label": "Twists",
                    "group": "short"
                },
                {
                    "id": "afro",
                    "label": "Afro",
                    "group": "short"
                },
                {
                    "id": "pixie",
                    "label": "Pixie",
                    "group": "short"
                },
                {
                    "id": "mop",
                    "label": "Mop",
                    "group": "medium"
                },
                {
                    "id": "wolfcut",
                    "label": "Wolf cut",
                    "group": "medium"
                },
                {
                    "id": "bob",
                    "label": "Bob",
                    "group": "medium"
                },
                {
                    "id": "flip",
                    "label": "Flipped bob",
                    "group": "medium"
                },
                {
                    "id": "lob",
                    "label": "Lob",
                    "group": "medium"
                },
                {
                    "id": "crownbraid",
                    "label": "Crown braid",
                    "group": "medium"
                },
                {
                    "id": "long",
                    "label": "Long",
                    "group": "long"
                },
                {
                    "id": "bangs",
                    "label": "Bangs",
                    "group": "long"
                },
                {
                    "id": "waves",
                    "label": "Waves",
                    "group": "long"
                },
                {
                    "id": "braids",
                    "label": "Braids",
                    "group": "long"
                },
                {
                    "id": "ponytail",
                    "label": "Ponytail",
                    "group": "tied"
                },
                {
                    "id": "highpony",
                    "label": "High ponytail",
                    "group": "tied"
                },
                {
                    "id": "lowtails",
                    "label": "Low pigtails",
                    "group": "tied"
                },
                {
                    "id": "bun",
                    "label": "Bun",
                    "group": "tied"
                },
                {
                    "id": "lowbun",
                    "label": "Low bun",
                    "group": "tied"
                },
                {
                    "id": "afropuff",
                    "label": "Afro puff",
                    "group": "tied"
                },
                {
                    "id": "pigtails",
                    "label": "Pigtails",
                    "group": "tied"
                },
                {
                    "id": "puffs",
                    "label": "Puffs",
                    "group": "tied"
                }
            ],
            "colours": [
                {
                    "id": "black",
                    "label": "Black",
                    "swatch": "#2b2c38"
                },
                {
                    "id": "espresso",
                    "label": "Dark brown",
                    "swatch": "#48352c"
                },
                {
                    "id": "brown",
                    "label": "Brown",
                    "swatch": "#704f3c"
                },
                {
                    "id": "chestnut",
                    "label": "Chestnut",
                    "swatch": "#8a5739"
                },
                {
                    "id": "auburn",
                    "label": "Auburn",
                    "swatch": "#984b2d"
                },
                {
                    "id": "copper",
                    "label": "Copper",
                    "swatch": "#c96c31"
                },
                {
                    "id": "strawberry",
                    "label": "Strawberry blond",
                    "swatch": "#d6935f"
                },
                {
                    "id": "golden",
                    "label": "Golden blond",
                    "swatch": "#d9ac59"
                },
                {
                    "id": "ash",
                    "label": "Ash blond",
                    "swatch": "#cabf9e"
                },
                {
                    "id": "silver",
                    "label": "Silver",
                    "swatch": "#a8adb8"
                },
                {
                    "id": "blue",
                    "label": "Blue",
                    "swatch": "#4c82d2",
                    "bold": true
                },
                {
                    "id": "pink",
                    "label": "Pink",
                    "swatch": "#e67dae",
                    "bold": true
                },
                {
                    "id": "purple",
                    "label": "Purple",
                    "swatch": "#8c65c6",
                    "bold": true
                },
                {
                    "id": "teal",
                    "label": "Teal",
                    "swatch": "#36a591",
                    "bold": true
                }
            ],
            "texture": "q3-hair-{style}-{colour}",
            "url": "resources/characters/quanta-v3/hair/{style}-{colour}.png"
        },
        {
            "key": "quantaGlasses",
            "part": "glasses",
            "label": "Glasses",
            "optional": true,
            "styles": [
                {
                    "id": "round",
                    "label": "Round"
                },
                {
                    "id": "square",
                    "label": "Square"
                },
                {
                    "id": "browline",
                    "label": "Browline"
                },
                {
                    "id": "cat",
                    "label": "Cat-eye"
                }
            ],
            "colours": [
                {
                    "id": "black",
                    "label": "Black",
                    "swatch": "#24212a"
                },
                {
                    "id": "tortoise",
                    "label": "Tortoiseshell",
                    "swatch": "#6e3f22"
                },
                {
                    "id": "navy",
                    "label": "Navy",
                    "swatch": "#26386a"
                },
                {
                    "id": "red",
                    "label": "Red",
                    "swatch": "#a83038"
                },
                {
                    "id": "gold",
                    "label": "Gold",
                    "swatch": "#a8822e"
                }
            ],
            "texture": "q3-glasses-{style}-{colour}",
            "url": "resources/characters/quanta-v3/glasses/{style}-{colour}.png"
        }
    ],
    "presets": {
        "quanta01": [
            "q3-skin-light",
            "q3-eyes-classic-brown",
            "q3-shoes-sneakers-white",
            "q3-bottoms-trousers-darkdenim",
            "q3-top-jacket-mustard",
            "q3-hair-crop-brown"
        ],
        "quanta02": [
            "q3-skin-fair",
            "q3-eyes-lashes-dark",
            "q3-shoes-sneakers-white",
            "q3-bottoms-trousers-grey",
            "q3-top-sweater-navy",
            "q3-hair-long-espresso"
        ],
        "quanta03": [
            "q3-skin-tan",
            "q3-eyes-soft-green",
            "q3-shoes-sneakers-white",
            "q3-bottoms-skirt-navy",
            "q3-top-tee-teal",
            "q3-hair-bob-black",
            "q3-glasses-round-navy"
        ],
        "quanta04": [
            "q3-skin-deep",
            "q3-eyes-classic-amber",
            "q3-shoes-sneakers-white",
            "q3-bottoms-joggers-black",
            "q3-top-hoodie-green",
            "q3-hair-buzz-black"
        ],
        "quanta05": [
            "q3-skin-light",
            "q3-eyes-lashes-green",
            "q3-shoes-flats-black",
            "q3-bottoms-skirt-black",
            "q3-top-jacket-lavender",
            "q3-hair-ponytail-auburn"
        ],
        "quanta06": [
            "q3-skin-brown",
            "q3-eyes-bright-brown",
            "q3-shoes-boots-black",
            "q3-bottoms-trousers-darkdenim",
            "q3-top-shirt-white",
            "q3-hair-curls-espresso"
        ],
        "quanta07": [
            "q3-skin-bronze",
            "q3-eyes-gentle-hazel",
            "q3-shoes-sneakers-white",
            "q3-bottoms-skirt-navy",
            "q3-top-stripes-sky",
            "q3-hair-long-black"
        ],
        "quanta08": [
            "q3-skin-fair",
            "q3-eyes-bright-blue",
            "q3-shoes-sneakers-white",
            "q3-bottoms-trousers-denim",
            "q3-top-tee-red",
            "q3-hair-crop-golden",
            "q3-glasses-square-black"
        ],
        "quanta09": [
            "q3-skin-warm",
            "q3-eyes-soft-hazel",
            "q3-shoes-sneakers-white",
            "q3-bottoms-trousers-grey",
            "q3-top-jacket-green",
            "q3-hair-curls-auburn"
        ],
        "quanta10": [
            "q3-skin-ebony",
            "q3-eyes-lashes-blue",
            "q3-shoes-sneakers-white",
            "q3-bottoms-skirt-navy",
            "q3-top-tee-lavender",
            "q3-hair-bun-black"
        ],
        "quanta11": [
            "q3-skin-olive",
            "q3-eyes-keen-brown",
            "q3-shoes-boots-brown",
            "q3-bottoms-trousers-black",
            "q3-top-jacket-charcoal",
            "q3-hair-sidepart-silver",
            "q3-glasses-browline-tortoise"
        ],
        "quanta12": [
            "q3-skin-porcelain",
            "q3-eyes-bright-blue",
            "q3-shoes-flats-pink",
            "q3-bottoms-skirt-denim",
            "q3-top-polo-pink",
            "q3-hair-bob-golden"
        ]
    }
};
