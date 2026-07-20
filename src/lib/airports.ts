// Airport database — Canadian airports + select international hubs, extended
// at runtime by the pilot's own placed airports (AppData.customAirports).
// Format: CODE: [lat, lon, "Name"]. Used both for the Route Map projection
// AND as the autocomplete source for the ICAO From/To fields.
//
// Unknown codes deliberately resolve to NULL, never a made-up position — the
// Route Map lists them for the pilot to place instead of plotting garbage.

import { CustomAirport } from "./types";

export const AIRPORTS_DB: Record<string, [number, number, string]> = {
  // ===== CANADA — British Columbia =====
  CYVR: [49.1939, -123.1844, "Vancouver International"],
  CYYJ: [48.6469, -123.4258, "Victoria International"],
  CYXX: [49.0253, -122.3606, "Abbotsford International"],
  CYLW: [49.9561, -119.3778, "Kelowna International"],
  CYXS: [53.8894, -122.6789, "Prince George"],
  CYBL: [49.9508, -125.2711, "Campbell River"],
  CYCD: [49.0547, -123.8703, "Nanaimo"],
  CYCG: [49.2964, -117.6322, "Castlegar/West Kootenay"],
  CYCW: [49.1528, -121.9389, "Chilliwack"],
  CYDQ: [55.7422, -120.1828, "Dawson Creek"],
  CYHE: [49.3681, -121.4986, "Hope"],
  CYKA: [50.7022, -120.4444, "Kamloops"],
  CYNJ: [49.1008, -122.6306, "Langley Regional"],
  CYPK: [49.2161, -122.71, "Pitt Meadows"],
  CYPR: [54.2861, -130.4456, "Prince Rupert"],
  CYPW: [49.8342, -124.5, "Powell River"],
  CYQQ: [49.7108, -124.8867, "Comox"],
  CYQZ: [53.0261, -122.5103, "Quesnel"],
  CYRV: [50.9667, -118.1833, "Revelstoke"],
  CYWL: [52.1831, -122.0544, "Williams Lake"],
  CYXC: [49.6108, -115.7822, "Cranbrook/Canadian Rockies"],
  CYXJ: [56.2381, -120.74, "Fort St. John"],
  CYXT: [54.4683, -128.5764, "Terrace"],
  CYXY: [60.7096, -135.0673, "Whitehorse"],
  CYYD: [54.8247, -127.1828, "Smithers"],
  CYYE: [58.8364, -122.5972, "Fort Nelson"],
  CYYF: [49.4631, -119.6019, "Penticton"],
  CYZP: [53.2543, -131.8139, "Sandspit"],
  CYZT: [50.6806, -127.3667, "Port Hardy"],
  CYZY: [55.3044, -123.1322, "Mackenzie"],
  CAH3: [49.6233, -114.3742, "Crowsnest"],

  // ===== CANADA — Alberta =====
  CYYC: [51.1139, -114.0203, "Calgary International"],
  CYEG: [53.3097, -113.58, "Edmonton International"],
  CYBW: [51.1031, -114.3742, "Calgary/Springbank"],
  CYMM: [56.6533, -111.2222, "Fort McMurray"],
  CYOD: [54.405, -110.2806, "Cold Lake"],
  CYPE: [56.2267, -117.4467, "Peace River"],
  CYQF: [52.1822, -113.8939, "Red Deer Regional"],
  CYQU: [55.1796, -118.8853, "Grande Prairie"],
  CYXD: [53.5725, -113.5217, "Edmonton/Villeneuve"],
  CYXH: [50.0189, -110.7211, "Medicine Hat"],
  CYZH: [55.2931, -114.7775, "Slave Lake"],
  CYZU: [54.1442, -115.7869, "Whitecourt"],
  CYOJ: [58.6217, -117.1644, "High Level"],

  // ===== CANADA — Saskatchewan =====
  CYXE: [52.1708, -106.6997, "Saskatoon/Diefenbaker"],
  CYQR: [50.4319, -104.6658, "Regina International"],
  CYPA: [53.2142, -105.6731, "Prince Albert"],
  CYQW: [52.7692, -108.2444, "North Battleford"],
  CYQV: [51.2647, -102.4617, "Yorkton"],
  CYVC: [55.1517, -105.2622, "La Ronge"],
  CYYN: [50.2917, -107.6911, "Swift Current"],
  CYYO: [51.7672, -104.2117, "Wynyard"],

  // ===== CANADA — Manitoba =====
  CYWG: [49.91, -97.2399, "Winnipeg International"],
  CYBR: [49.91, -99.9519, "Brandon"],
  CYFO: [54.6781, -101.6817, "Flin Flon"],
  CYLR: [56.5133, -99.9853, "Leaf Rapids"],
  CYTH: [55.8011, -97.8642, "Thompson"],
  CYYL: [56.8639, -101.0758, "Lynn Lake"],
  CYYQ: [58.7392, -94.065, "Churchill"],
  CYPG: [49.9031, -98.2739, "Portage la Prairie"],

  // ===== CANADA — Ontario =====
  CYYZ: [43.6772, -79.6306, "Toronto Pearson"],
  CYTZ: [43.6275, -79.3962, "Toronto/Billy Bishop"],
  CYOW: [45.3225, -75.6692, "Ottawa International"],
  CYHM: [43.1736, -79.935, "Hamilton"],
  CYKF: [43.4608, -80.3786, "Kitchener/Waterloo"],
  CYXU: [43.0356, -81.1539, "London"],
  CYQT: [48.3719, -89.3239, "Thunder Bay"],
  CYQG: [42.2756, -82.9556, "Windsor"],
  CYGK: [44.2253, -76.5969, "Kingston"],
  CYTR: [44.1189, -77.5283, "Trenton"],
  CYTS: [48.5697, -81.3767, "Timmins"],
  CYSB: [46.6253, -80.7989, "Sudbury"],
  CYYB: [46.3636, -79.4233, "North Bay"],
  CYAM: [46.4853, -84.5094, "Sault Ste. Marie"],
  CYMO: [51.2911, -80.6078, "Moosonee"],
  CYQA: [44.9747, -79.3033, "Muskoka"],
  CYOS: [44.5908, -80.8378, "Owen Sound"],
  CYQK: [49.7883, -94.3631, "Kenora"],
  CYQS: [42.77, -81.1108, "St. Thomas"],
  CYRL: [51.0667, -93.7931, "Red Lake"],
  CYZE: [45.8853, -82.5678, "Gore Bay-Manitoulin"],
  CYZR: [42.9994, -82.3089, "Sarnia"],
  CYXR: [47.6972, -79.8472, "Earlton"],
  CYXZ: [47.9667, -84.7867, "Wawa"],
  CYYU: [49.4139, -82.4675, "Kapuskasing"],
  CYYW: [50.29, -88.9092, "Armstrong"],
  CYXL: [50.1139, -91.905, "Sioux Lookout"],
  CYNN: [50.1825, -86.6964, "Nakina"],
  CYPL: [51.4458, -90.2142, "Pickle Lake"],
  CYTL: [53.8175, -89.8967, "Big Trout Lake"],
  CYOO: [43.9225, -78.895, "Oshawa"],
  CNC3: [43.8617, -79.9261, "Brampton"],
  CNF4: [44.075, -79.55, "Lake Simcoe Regional"],

  // ===== CANADA — Quebec =====
  CYUL: [45.4706, -73.7408, "Montreal/Trudeau"],
  CYQB: [46.7911, -71.3933, "Quebec/Jean Lesage"],
  CYHU: [45.5175, -73.4169, "Montreal/Saint-Hubert"],
  CYMX: [45.68, -74.0386, "Montreal/Mirabel"],
  CYBC: [49.1325, -68.2044, "Baie-Comeau"],
  CYBG: [48.3306, -71.0, "Bagotville"],
  CYFJ: [46.4094, -74.78, "Mont-Tremblant"],
  CYGL: [53.6253, -77.7042, "La Grande Rivière"],
  CYGW: [55.2819, -77.7653, "Kuujjuarapik"],
  CYIK: [62.4172, -77.9253, "Ivujivik"],
  CYKQ: [51.4733, -78.7575, "Waskaganish"],
  CYNC: [53.0106, -78.8311, "Wemindji"],
  CYRJ: [48.52, -72.2658, "Roberval"],
  CYTQ: [58.6678, -69.9558, "Tasiujaq"],
  CYVB: [48.0711, -65.4603, "Bonaventure"],
  CYVO: [48.0533, -77.7828, "Val-d'Or"],
  CYVP: [58.0961, -68.4267, "Kuujjuaq"],
  CYXK: [48.4781, -68.4969, "Rimouski"],
  CYZV: [50.2233, -66.2656, "Sept-Îles"],

  // ===== CANADA — Atlantic =====
  CYHZ: [44.8808, -63.5086, "Halifax/Stanfield"],
  CYAW: [44.6394, -63.4992, "Shearwater"],
  CYQI: [43.8269, -66.0883, "Yarmouth"],
  CYQM: [46.1122, -64.6786, "Moncton/Greater Moncton"],
  CYQY: [46.1614, -60.0478, "Sydney"],
  CYZX: [44.9844, -64.9169, "Greenwood"],
  CYSJ: [45.3161, -65.8903, "Saint John"],
  CYFC: [45.8689, -66.5372, "Fredericton"],
  CYYG: [46.29, -63.1211, "Charlottetown"],
  CYYT: [47.6186, -52.7519, "St. John's"],
  CYQX: [48.9369, -54.5681, "Gander"],
  CYDF: [49.2108, -57.3914, "Deer Lake"],
  CYJT: [48.5444, -58.55, "Stephenville"],
  CYAY: [51.3919, -56.0831, "St. Anthony"],
  CYWK: [52.9219, -66.8644, "Wabush"],

  // ===== CANADA — Northern (Yukon, NWT, Nunavut) =====
  CYZF: [62.4628, -114.4403, "Yellowknife"],
  CYFB: [63.7564, -68.5558, "Iqaluit"],
  CYEV: [68.3042, -133.4828, "Inuvik/Mike Zubko"],
  CYBK: [64.2989, -96.0778, "Baker Lake"],
  CYCO: [67.8167, -115.1444, "Kugluktuk"],
  CYCY: [70.4861, -68.5167, "Clyde River"],
  CYEK: [61.0942, -94.0708, "Arviat"],
  CYFR: [61.1808, -113.69, "Fort Resolution"],
  CYFS: [61.76, -121.2367, "Fort Simpson"],
  CYGT: [69.3647, -81.8158, "Igloolik"],
  CYHY: [60.8397, -115.7828, "Hay River"],
  CYIO: [72.6833, -77.9667, "Pond Inlet"],
  CYOA: [64.7, -110.6167, "Ekati"],
  CYOC: [67.5703, -139.8389, "Old Crow"],
  CYRB: [74.7169, -94.9694, "Resolute Bay"],
  CYSM: [60.0203, -111.9617, "Fort Smith"],
  CYSY: [71.9939, -125.2425, "Sachs Harbour"],
  CYTE: [64.23, -76.5267, "Cape Dorset"],
  CYUB: [69.4333, -133.025, "Tuktoyaktuk"],
  CYUT: [66.5214, -86.2247, "Naujaat"],
  CYUX: [68.7761, -81.2425, "Hall Beach"],
  CYVQ: [65.2814, -126.7978, "Norman Wells"],
  CYWY: [63.2092, -123.4367, "Wrigley"],
  CYXN: [62.24, -92.5981, "Whale Cove"],
  CYXP: [66.145, -65.7136, "Pangnirtung"],
  CYXC2: [63.2492, -74.9319, "Kimmirut"],
  CYYH: [69.5467, -93.5767, "Taloyoak"],
  CYZS: [64.1933, -83.3592, "Coral Harbour"],
  CYZW: [60.1728, -132.7428, "Teslin"],
  CYQH: [60.1164, -128.8222, "Watson Lake"],

  // ===== USA — major hubs =====
  KJFK: [40.6398, -73.7789, "New York/JFK"],
  KLGA: [40.7772, -73.8726, "New York/LaGuardia"],
  KEWR: [40.6925, -74.1687, "Newark Liberty"],
  KBOS: [42.3631, -71.0064, "Boston/Logan"],
  KLAX: [33.9425, -118.4081, "Los Angeles"],
  KSFO: [37.6189, -122.375, "San Francisco"],
  KSEA: [47.4502, -122.3088, "Seattle/Tacoma"],
  KORD: [41.9786, -87.9048, "Chicago O'Hare"],
  KATL: [33.6367, -84.4281, "Atlanta"],
  KDFW: [32.8968, -97.038, "Dallas/Fort Worth"],
  KDEN: [39.8617, -104.6731, "Denver"],
  KMIA: [25.7932, -80.2906, "Miami"],
  KLAS: [36.084, -115.1537, "Las Vegas/Harry Reid"],
  KPHX: [33.4342, -112.0116, "Phoenix/Sky Harbor"],
  KIAH: [29.9844, -95.3414, "Houston/Bush"],
  KDTW: [42.2124, -83.3534, "Detroit Metro"],
  KMSP: [44.882, -93.2218, "Minneapolis/St. Paul"],
  KBUF: [42.9405, -78.7322, "Buffalo Niagara"],
  KBIL: [45.8077, -108.543, "Billings"],
  KGEG: [47.6199, -117.5338, "Spokane"],
  KPDX: [45.5887, -122.5975, "Portland/PDX"],
  KSLC: [40.7884, -111.9778, "Salt Lake City"],

  // ===== International — common transit =====
  EGLL: [51.47, -0.4543, "London Heathrow"],
  EGKK: [51.1481, -0.1903, "London Gatwick"],
  LFPG: [49.0097, 2.5479, "Paris Charles de Gaulle"],
  EDDF: [50.0379, 8.5622, "Frankfurt"],
  EHAM: [52.3105, 4.7683, "Amsterdam Schiphol"],
  LEMD: [40.4839, -3.568, "Madrid Barajas"],
  LIRF: [41.8003, 12.2389, "Rome Fiumicino"],
  RJTT: [35.5494, 139.7798, "Tokyo Haneda"],
  RJAA: [35.772, 140.3929, "Tokyo Narita"],
  VHHH: [22.308, 113.9185, "Hong Kong"],
  WSSS: [1.3644, 103.9915, "Singapore Changi"],
  YSSY: [-33.9461, 151.1772, "Sydney"],
  OMDB: [25.2532, 55.3657, "Dubai International"],
  ZBAA: [40.0799, 116.6031, "Beijing Capital"],
  VIDP: [28.5562, 77.1, "Delhi Indira Gandhi"],
  SBGR: [-23.4356, -46.4731, "São Paulo/Guarulhos"],
  MMMX: [19.4363, -99.0721, "Mexico City"],
  FAOR: [-26.1392, 28.246, "Johannesburg/O.R. Tambo"],
};

// [lat, lon] view, used by the map projection and coord fallback.
export const AIRPORTS: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(AIRPORTS_DB).map(([k, v]) => [k, [v[0], v[1]]]),
);

export function normalizeAirportCode(code: string): string {
  return code.trim().toUpperCase();
}

// The pilot's placed airports as a lookup map (normalized codes; a custom
// entry may shadow a built-in, letting the pilot correct a position).
function customMap(custom?: CustomAirport[]): Map<string, CustomAirport> {
  const m = new Map<string, CustomAirport>();
  (custom ?? []).forEach((a) => {
    const k = normalizeAirportCode(a.code);
    if (k && isFinite(a.lat) && isFinite(a.lon)) m.set(k, a);
  });
  return m;
}

export function airportLabel(code: string, custom?: CustomAirport[]): string {
  const k = normalizeAirportCode(code);
  const c = customMap(custom).get(k);
  if (c) return c.name ? `${k} — ${c.name}` : k;
  const a = AIRPORTS_DB[k];
  return a ? `${k} — ${a[2]}` : code;
}

// Real coordinates for a code, or null when nobody knows where it is. The
// pilot's own placement wins over the built-in DB.
export function airportCoord(code: string, custom?: CustomAirport[]): [number, number] | null {
  const k = normalizeAirportCode(code);
  const c = customMap(custom).get(k);
  if (c) return [c.lat, c.lon];
  return AIRPORTS[k] ?? null;
}

// Canadian ICAO codes sorted first, then everything else alphabetically —
// used to order the autocomplete datalist. Custom airports are included.
export function sortedAirportCodes(custom?: CustomAirport[]): string[] {
  const codes = Array.from(new Set([
    ...Object.keys(AIRPORTS_DB),
    ...Array.from(customMap(custom).keys()),
  ]));
  const isCa = (c: string) =>
    c.startsWith("CY") || c.startsWith("CZ") || c.startsWith("CN") || c.startsWith("CA");
  return codes.sort((a, b) => {
    if (isCa(a) && !isCa(b)) return -1;
    if (isCa(b) && !isCa(a)) return 1;
    return a.localeCompare(b);
  });
}
