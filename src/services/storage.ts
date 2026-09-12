import {
  Company,
  PortConfig,
  DepotConfig,
  RegistrationSubmission,
  PortLocation,
  RegistrationType,
  SubmissionStatus,
  HaulierGuideline,
} from '../types';
import { normalizeCompanyType, normalizeRegNo } from './companyHelper';
import { deleteSupabaseRow, fetchSupabaseSnapshot, isSupabaseConfigured, upsertSupabaseRow } from './supabase';

const STORAGE_KEYS = {
  COMPANIES: 'port_reg_companies_v1',
  PORTS: 'port_reg_ports_v1',
  DEPOTS: 'port_reg_depots_v1',
  SUBMISSIONS: 'port_reg_submissions_v1',
  INITIALIZED: 'port_reg_initialized_v1',
  HAULIER_GUIDELINE: 'port_reg_haulier_guideline_v1',
};

// Default ports matching prompt section 1 & 10
export const INITIAL_PORTS: PortConfig[] = [
  {
    id: 'pk-westport',
    location: 'PORT_KLANG',
    display_name: 'WESTPORT',
    code: 'WESTPORT',
    backend_port_id: '5ad78eeb458efa4c5a1fc007',
    active: true,
    description: 'Port Klang - Westport Terminal Container Gate',
  },
  {
    id: 'pk-northport',
    location: 'PORT_KLANG',
    display_name: 'NORTHPORT',
    code: 'NORTHPORT',
    backend_port_id: '5adc9dd77753d26fb07d6f26',
    active: true,
    description: 'Port Klang - Northport Gateway',
  },
  {
    id: 'kuantan-kp1',
    location: 'OTHER',
    display_name: 'KUANTAN PORT CONSORTIUM KP1',
    code: 'KUANTAN-KP1',
    backend_port_id: '6035de9b05c73c72066a2317',
    active: true,
    description: 'Kuantan Port Consortium Sdn Bhd KP1',
  },
  {
    id: 'kuantan-kp2',
    location: 'OTHER',
    display_name: 'KUANTAN PORT CONSORTIUM KP2',
    code: 'KUANTAN-KP2',
    backend_port_id: '6282882c55b7d22daf3c250f',
    active: true,
    description: 'Kuantan Port Consortium Sdn Bhd KP2',
  },
  {
    id: 'lumut-maritime-terminal',
    location: 'OTHER',
    display_name: 'LUMUT MARITIME TERMINAL',
    code: 'LUMUT-MARITIME',
    backend_port_id: '6790dd54fbf06143a0210f16',
    active: true,
    description: 'Lumut Maritime Terminal Sdn Bhd',
  },
  {
    id: 'penang-port',
    location: 'OTHER',
    display_name: 'PENANG PORT',
    code: 'PENANG-PORT',
    backend_port_id: '5c3c22be456c0b4014987343',
    active: true,
    description: 'Penang Port Sdn Bhd',
  },
  {
    id: 'port-klang-free-zone',
    location: 'OTHER',
    display_name: 'PORT KLANG FREE ZONE',
    code: 'PORT-KLANG-FREE-ZONE',
    backend_port_id: '5d3c1b79c3b55162a48f463a',
    active: true,
    description: 'Port Klang Free Zone Sdn Bhd',
  },
  {
    id: 'johor-port',
    location: 'JOHOR',
    display_name: 'JOHOR PORT',
    code: 'JOHOR-PORT',
    backend_port_id: '',
    active: true,
    description: 'Johor Port terminal mapping',
  },
];

export const INITIAL_DEPOTS: DepotConfig[] = [
  {
    id: 'depot-wp-1',
    port_id: 'pk-westport',
    display_name: 'WP Container Yard 1',
    backend_depot_id: 'DEP-WP-01',
    active: true,
  },
  {
    id: 'depot-np-1',
    port_id: 'pk-northport',
    display_name: 'NP North Gate Yard',
    backend_depot_id: 'DEP-NP-01',
    active: true,
  },
  {
    id: 'depot-ics-1',
    port_id: 'johor-port',
    display_name: 'PG-ICS DEPOT SERVICES SDN. BHD.',
    backend_depot_id: '694e2f62c6b51b68814f6ef7',
    active: true,
  },
  {
    id: 'depot-pgd-1',
    port_id: 'johor-port',
    display_name: 'PG-INFINITY CONTAINER PARK 1',
    backend_depot_id: '6965b7b3ce7f708dfcd5cd8b',
    active: true,
  },
];

export const INITIAL_COMPANIES: Company[] = [
  {
    id: 'comp-1',
    registration_number: 'AAAAAA-2',
    registration_number_old: 'AAAAAA-2',
    registration_number_new: '201901004521',
    name: 'LUMORA TECH',
    short_name: 'LUMORA',
    company_type: 'FORWARDER',
    haulier_id: '',
    forwarding_agent_id: '64abc123xyz',
    port_id: 'jh-pg-ics',
    depot_id: 'depot-ics-1',
    block: 'Level 8, Tower A',
    address1: 'No 15, Jalan Pelabuhan 3',
    address2: 'Kawasan Perindustrian Pasir Gudang',
    city: 'Pasir Gudang',
    state: 'Johor',
    postcode: '81700',
    country: 'Malaysia',
    contact_name: 'Kevin Tan',
    contact_email: 'kevin.tan@lumoratech.com',
    contact_designation: 'Logistics Manager',
    contact_mobile: '+60123456789',
    office_phone: '+6072518899',
    fax: '+6072518898',
    status: 'ACTIVE',
    created_at: '2026-08-10T08:30:00.000Z',
    updated_at: '2026-09-01T10:15:00.000Z',
  },
  {
    id: 'comp-2',
    registration_number: 'BBBBBB-1',
    registration_number_old: 'BBBBBB-1',
    registration_number_new: '201801008892',
    name: 'ABC HAULAGE SDN BHD',
    short_name: 'ABC HAULAGE',
    company_type: 'HAULAGE',
    haulier_id: 'xyz456',
    forwarding_agent_id: '',
    port_id: 'jh-pg-ics',
    depot_id: 'depot-ics-1',
    block: 'HQ Building',
    address1: 'Plot 42, Heavy Industrial Estate',
    address2: 'Jalan Pasir',
    city: 'Pasir Gudang',
    state: 'Johor',
    postcode: '81707',
    country: 'Malaysia',
    contact_name: 'Ahmad Razif',
    contact_email: 'razif@abchaulage.com.my',
    contact_designation: 'Fleet Director',
    contact_mobile: '+60198765432',
    office_phone: '+6072551122',
    fax: '+6072551120',
    status: 'ACTIVE',
    created_at: '2026-08-14T09:00:00.000Z',
    updated_at: '2026-09-02T11:20:00.000Z',
  },
  {
    id: 'comp-3',
    registration_number: 'CCCCCC-3',
    registration_number_old: 'CCCCCC-3',
    registration_number_new: '202102009183',
    name: 'SOUTHERN FREIGHT FORWARDING SDN BHD',
    short_name: 'SOUTHERN FWD',
    company_type: 'FORWARDER',
    haulier_id: '',
    forwarding_agent_id: '', // INTENTIONALLY MISSING to demonstrate requirement 12 warning!
    port_id: 'jh-pg-depot',
    depot_id: 'depot-pgd-1',
    block: 'Unit 3A',
    address1: 'Wisma Southern Freight, Jalan Cemerlang',
    address2: 'Taman Perindustrian Pasir Gudang',
    city: 'Pasir Gudang',
    state: 'Johor',
    postcode: '81700',
    country: 'Malaysia',
    contact_name: 'Mei Ling Lee',
    contact_email: 'meiling@southernfreight.my',
    contact_designation: 'Operations Coordinator',
    contact_mobile: '+60167123984',
    office_phone: '+6072520033',
    fax: '+6072520034',
    status: 'ACTIVE',
    created_at: '2026-09-05T04:00:00.000Z',
    updated_at: '2026-09-05T04:00:00.000Z',
  },
  {
    id: 'comp-4',
    registration_number: 'DDDDDD-4',
    registration_number_old: 'DDDDDD-4',
    registration_number_new: '202001099231',
    name: 'KLANG VALLEY CONTAINER HAULIER',
    short_name: 'KV HAULIER',
    company_type: 'HAULAGE',
    haulier_id: '', // INTENTIONALLY MISSING to demonstrate HAULIERID missing warning!
    forwarding_agent_id: '',
    port_id: 'pk-westport',
    depot_id: 'depot-wp-1',
    block: 'Ground Floor',
    address1: 'Kompleks Kontena Westport',
    address2: 'Pulau Indah Industrial Park',
    city: 'Pelabuhan Klang',
    state: 'Selangor',
    postcode: '42920',
    country: 'Malaysia',
    contact_name: 'K. Rajan',
    contact_email: 'rajan@kvhaulier.com.my',
    contact_designation: 'General Manager',
    contact_mobile: '+60124445555',
    office_phone: '+60331688800',
    fax: '+60331688801',
    status: 'ACTIVE',
    created_at: '2026-09-08T03:30:00.000Z',
    updated_at: '2026-09-08T03:30:00.000Z',
  },
];

export const INITIAL_SUBMISSIONS: RegistrationSubmission[] = [
  {
    id: 'sub-001',
    reference_no: 'REG-20260910-0101',
    registration_type: 'DRIVER',
    company_id: 'comp-1',
    company_reg_no: 'AAAAAA-2',
    company_name: 'LUMORA TECH',
    company_type: 'FORWARDER',
    port_location: 'JOHOR',
    port_id: 'jh-pg-ics',
    depot_id: 'depot-ics-1',
    status: 'READY_TO_EXPORT',
    submitted_at: '2026-09-10T09:15:00.000Z',
    submitted_by_name: 'Kevin Tan',
    submitted_by_email: 'kevin.tan@lumoratech.com',
    submitted_by_mobile: '+60123456789',
    data: {
      driver: {
        driving_license: 'DL-840212015567',
        name: 'Mohd Firdaus bin Abdullah',
        mobile_no: '+60178823194',
      },
    },
  },
  {
    id: 'sub-002',
    reference_no: 'REG-20260910-0102',
    registration_type: 'TRAILER',
    company_id: 'comp-1',
    company_reg_no: 'AAAAAA-2',
    company_name: 'LUMORA TECH',
    company_type: 'FORWARDER',
    port_location: 'JOHOR',
    port_id: 'jh-pg-ics',
    depot_id: 'depot-ics-1',
    status: 'PENDING',
    submitted_at: '2026-09-10T11:40:00.000Z',
    submitted_by_name: 'Kevin Tan',
    submitted_by_email: 'kevin.tan@lumoratech.com',
    submitted_by_mobile: '+60123456789',
    data: {
      trailer: {
        registration_number: 'JTE 4821',
        weight: '6500',
        trailer_type: 'FL',
        bdm_weight: '38000',
      },
      trailers: [
        {
          registration_number: 'JTE 4821',
          weight: '6500',
          trailer_type: 'FL',
          bdm_weight: '38000',
        },
        {
          registration_number: 'JTE 4822',
          weight: '6800',
          trailer_type: 'SL',
          bdm_weight: '40000',
        },
      ],
    },
  },
  {
    id: 'sub-003',
    reference_no: 'REG-20260911-0201',
    registration_type: 'VEHICLE',
    company_id: 'comp-2',
    company_reg_no: 'BBBBBB-1',
    company_name: 'ABC HAULAGE SDN BHD',
    company_type: 'HAULAGE',
    port_location: 'JOHOR',
    port_id: 'jh-pg-ics',
    depot_id: 'depot-ics-1',
    status: 'EXPORTED',
    submitted_at: '2026-09-11T08:20:00.000Z',
    submitted_by_name: 'Ahmad Razif',
    submitted_by_email: 'razif@abchaulage.com.my',
    submitted_by_mobile: '+60198765432',
    reviewed_at: '2026-09-11T09:00:00.000Z',
    exported_at: '2026-09-11T09:05:00.000Z',
    export_filename: 'ABC_HAULAGE_VEHICLE_20260911.xlsx',
    data: {
      vehicle: {
        registration_number: 'JVF 9902',
        weight: '8200',
        bgk_weight: '44000',
        head: 'HD-801',
      },
      vehicles: [
        {
          registration_number: 'JVF 9902',
          weight: '8200',
          bgk_weight: '44000',
          head: 'HD-801',
        },
        {
          registration_number: 'JVF 9903',
          weight: '8400',
          bgk_weight: '44000',
          head: 'HD-802',
        },
      ],
    },
  },
  {
    id: 'sub-004',
    reference_no: 'REG-20260911-0305',
    registration_type: 'DRIVER',
    company_id: 'comp-3',
    company_reg_no: 'CCCCCC-3',
    company_name: 'SOUTHERN FREIGHT FORWARDING SDN BHD',
    company_type: 'FORWARDER',
    port_location: 'JOHOR',
    port_id: 'jh-pg-depot',
    depot_id: 'depot-pgd-1',
    status: 'PENDING',
    submitted_at: '2026-09-11T14:10:00.000Z',
    submitted_by_name: 'Mei Ling Lee',
    submitted_by_email: 'meiling@southernfreight.my',
    submitted_by_mobile: '+60167123984',
    admin_notes: 'Missing Forwarding Agent ID in Company Master',
    data: {
      driver: {
        driving_license: 'DL-901103016621',
        name: 'Chong Wei Lun',
        mobile_no: '+60129933441',
      },
      drivers: [
        {
          driving_license: 'DL-901103016621',
          name: 'Chong Wei Lun',
          mobile_no: '+60129933441',
        },
        {
          driving_license: 'DL-880415085532',
          name: 'Suresh a/l Ramasamy',
          mobile_no: '+60178822194',
        },
      ],
    },
  },
  {
    id: 'sub-005',
    reference_no: 'REG-20260912-0401',
    registration_type: 'COMPANY',
    company_id: '',
    company_reg_no: 'WP-99218-X',
    company_name: 'NORTHPORT LOGISTICS PARTNERS',
    company_type: 'HAULAGE',
    port_location: 'PORT_KLANG',
    port_id: 'pk-northport',
    depot_id: 'depot-np-1',
    status: 'PENDING',
    submitted_at: '2026-09-12T01:30:00.000Z',
    submitted_by_name: 'Nurul Huda',
    submitted_by_email: 'huda@northportlog.com.my',
    submitted_by_mobile: '+60133221199',
    data: {
      company: {
        name: 'NORTHPORT LOGISTICS PARTNERS',
        short_name: 'NLP',
        company_type: 'HAULAGE',
        registration_number_old: 'WP-99218-X',
        registration_number_new: '202301048123',
        port_id: 'pk-northport',
        depot_id: 'depot-np-1',
        block: 'Wisma NLP, Lot 12',
        address1: 'Jalan Sultan Hishamuddin',
        address2: 'Kawasan Perindustrian Selat Klang Utara',
        city: 'Pelabuhan Klang',
        state: 'Selangor',
        postcode: '42000',
        country: 'Malaysia',
        contact_name: 'Nurul Huda',
        contact_email: 'huda@northportlog.com.my',
        contact_designation: 'Director',
        contact_mobile: '+60133221199',
        office_phone: '+60331765500',
        fax: '+60331765501',
      },
    },
  },
];

type StorageListener = () => void;
const listeners = new Set<StorageListener>();
let remoteHydrationStarted = false;

function companyRow(company: Company) {
  const { block, address1, address2, city, state, postcode, country, contact_name, contact_email, contact_designation, contact_mobile, office_phone, fax, ...master } = company;
  return { ...master, details: { block, address1, address2, city, state, postcode, country, contact_name, contact_email, contact_designation, contact_mobile, office_phone, fax } };
}

function syncCompany(company: Company) { void upsertSupabaseRow('companies', companyRow(company)); }
function syncPort(port: PortConfig) { void upsertSupabaseRow('port_configs', port); }
function syncDepot(depot: DepotConfig) { void upsertSupabaseRow('depot_configs', depot); }
function syncSubmission(submission: RegistrationSubmission) { void upsertSupabaseRow('registration_submissions', submission); }

async function hydrateFromSupabase() {
  if (!isSupabaseConfigured || remoteHydrationStarted) return;
  remoteHydrationStarted = true;
  const snapshot = await fetchSupabaseSnapshot();
  if (!snapshot) return;
  localStorage.setItem(STORAGE_KEYS.PORTS, JSON.stringify(snapshot.ports));
  localStorage.setItem(STORAGE_KEYS.DEPOTS, JSON.stringify(snapshot.depots));
  localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(snapshot.companies));
  localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(snapshot.submissions));
  if (snapshot.guideline) localStorage.setItem(STORAGE_KEYS.HAULIER_GUIDELINE, JSON.stringify(snapshot.guideline));
  notifyListeners();
}

export function subscribeToStorage(callback: StorageListener): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.error('Storage listener error:', e);
    }
  });
}

/**
 * Initialize mock master data into localStorage if not present
 */
export function initStorage(): void {
  if (typeof window === 'undefined') return;

  void hydrateFromSupabase();

  const initialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
  if (!initialized) {
    localStorage.setItem(STORAGE_KEYS.PORTS, JSON.stringify(INITIAL_PORTS));
    localStorage.setItem(STORAGE_KEYS.DEPOTS, JSON.stringify(INITIAL_DEPOTS));
    localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(INITIAL_COMPANIES.map((company) => ({
      ...company,
      port_id: company.port_id === 'jh-pg-ics' || company.port_id === 'jh-pg-depot' ? 'johor-port' : company.port_id,
    }))));
    localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(INITIAL_SUBMISSIONS.map((submission) => ({
      ...submission,
      port_id: submission.port_id === 'jh-pg-ics' || submission.port_id === 'jh-pg-depot' ? 'johor-port' : submission.port_id,
      data: {
        ...submission.data,
        company: submission.data.company ? {
          ...submission.data.company,
          port_id: submission.data.company.port_id === 'jh-pg-ics' || submission.data.company.port_id === 'jh-pg-depot' ? 'johor-port' : submission.data.company.port_id,
        } : submission.data.company,
      },
    }))));
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  } else {
    // Keep existing browser data aligned with the current port backend master list.
    try {
      const rawPorts = localStorage.getItem(STORAGE_KEYS.PORTS);
      if (rawPorts) {
        const ports: PortConfig[] = JSON.parse(rawPorts);
        let modified = false;
        INITIAL_PORTS.forEach((defaultPort) => {
          const existing = ports.find((port) => port.id === defaultPort.id || port.code === defaultPort.code);
          if (!existing) {
            ports.push(defaultPort);
            modified = true;
            return;
          }

          if (defaultPort.id !== 'johor-port' && existing.backend_port_id !== defaultPort.backend_port_id) {
            existing.backend_port_id = defaultPort.backend_port_id;
            modified = true;
          }
        });
        const filteredPorts = ports.filter((port) => port.id !== 'jh-pg-ics' && port.id !== 'jh-pg-depot');
        if (filteredPorts.length !== ports.length) {
          ports.splice(0, ports.length, ...filteredPorts);
          modified = true;
        }
        if (!ports.some((port) => port.id === 'johor-port')) {
          ports.push(INITIAL_PORTS.find((port) => port.id === 'johor-port')!);
          modified = true;
        }
        const rawDepots = localStorage.getItem(STORAGE_KEYS.DEPOTS);
        if (rawDepots) {
          const depots: DepotConfig[] = JSON.parse(rawDepots);
          let depotsModified = false;
          INITIAL_DEPOTS.forEach((defaultDepot) => {
            const existing = depots.find((depot) => depot.id === defaultDepot.id);
            if (existing && (existing.display_name !== defaultDepot.display_name || existing.backend_depot_id !== defaultDepot.backend_depot_id)) {
              existing.display_name = defaultDepot.display_name;
              existing.backend_depot_id = defaultDepot.backend_depot_id;
              depotsModified = true;
            }
            if (existing && (existing.id === 'depot-ics-1' || existing.id === 'depot-pgd-1') && existing.port_id !== 'johor-port') {
              existing.port_id = 'johor-port';
              depotsModified = true;
            }
          });
          if (depotsModified) {
            localStorage.setItem(STORAGE_KEYS.DEPOTS, JSON.stringify(depots));
          }
        }
        const rawCompanies = localStorage.getItem(STORAGE_KEYS.COMPANIES);
        if (rawCompanies) {
          const companies: Company[] = JSON.parse(rawCompanies);
          const normalizedCompanies = companies.map((company) => company.port_id === 'jh-pg-ics' || company.port_id === 'jh-pg-depot'
            ? { ...company, port_id: 'johor-port' }
            : company);
          if (JSON.stringify(companies) !== JSON.stringify(normalizedCompanies)) {
            localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(normalizedCompanies));
          }
        }
        const rawSubmissions = localStorage.getItem(STORAGE_KEYS.SUBMISSIONS);
        if (rawSubmissions) {
          const submissions: RegistrationSubmission[] = JSON.parse(rawSubmissions);
          const normalizedSubmissions = submissions.map((submission) => ({
            ...submission,
            port_id: submission.port_id === 'jh-pg-ics' || submission.port_id === 'jh-pg-depot' ? 'johor-port' : submission.port_id,
            data: {
              ...submission.data,
              company: submission.data.company ? {
                ...submission.data.company,
                port_id: submission.data.company.port_id === 'jh-pg-ics' || submission.data.company.port_id === 'jh-pg-depot' ? 'johor-port' : submission.data.company.port_id,
              } : submission.data.company,
            },
          }));
          if (JSON.stringify(submissions) !== JSON.stringify(normalizedSubmissions)) {
            localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(normalizedSubmissions));
          }
        }
        if (modified) {
          localStorage.setItem(STORAGE_KEYS.PORTS, JSON.stringify(ports));
        }
      }
    } catch {
      // ignore
    }
  }
}

// Reset data to defaults
export function resetStorage(): void {
  localStorage.setItem(STORAGE_KEYS.PORTS, JSON.stringify(INITIAL_PORTS));
  localStorage.setItem(STORAGE_KEYS.DEPOTS, JSON.stringify(INITIAL_DEPOTS));
  localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(INITIAL_COMPANIES.map((company) => ({
    ...company,
    port_id: company.port_id === 'jh-pg-ics' || company.port_id === 'jh-pg-depot' ? 'johor-port' : company.port_id,
  }))));
  localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(INITIAL_SUBMISSIONS.map((submission) => ({
    ...submission,
    port_id: submission.port_id === 'jh-pg-ics' || submission.port_id === 'jh-pg-depot' ? 'johor-port' : submission.port_id,
  }))));
  localStorage.setItem(STORAGE_KEYS.HAULIER_GUIDELINE, JSON.stringify(DEFAULT_HAULIER_GUIDELINE));
  localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  notifyListeners();
}

export const resetToDemoData = resetStorage;

// ==================== PORTS & DEPOTS ====================

export function getPorts(): PortConfig[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PORTS);
    return raw ? JSON.parse(raw) : INITIAL_PORTS;
  } catch {
    return INITIAL_PORTS;
  }
}

export function savePort(port: PortConfig): void {
  const ports = getPorts();
  const index = ports.findIndex((p) => p.id === port.id);
  if (index >= 0) {
    ports[index] = port;
  } else {
    ports.push(port);
  }
  localStorage.setItem(STORAGE_KEYS.PORTS, JSON.stringify(ports));
  syncPort(port);
  notifyListeners();
}

export function updatePortConfig(
  portId: string,
  updates: Partial<PortConfig>
): PortConfig | null {
  const ports = getPorts();
  const index = ports.findIndex((p) => p.id === portId);
  if (index < 0) return null;
  ports[index] = { ...ports[index], ...updates };
  localStorage.setItem(STORAGE_KEYS.PORTS, JSON.stringify(ports));
  syncPort(ports[index]);
  notifyListeners();
  return ports[index];
}

export function deletePortConfig(portId: string): boolean {
  const depots = getDepots();
  if (depots.some((depot) => depot.port_id === portId)) return false;

  const ports = getPorts().filter((port) => port.id !== portId);
  localStorage.setItem(STORAGE_KEYS.PORTS, JSON.stringify(ports));
  void deleteSupabaseRow('port_configs', portId);
  notifyListeners();
  return true;
}

/**
 * Returns auto-assigned ports and comma-separated backend IDs.
 * For Port Klang: WESTPORT and NORTHPORT backend IDs.
 * For Johor: the configured JOHOR PORT backend ID, when present
 */
export function getAutoAssignedPorts(location: PortLocation): {
  location: PortLocation;
  portNames: string[];
  backendIdsString: string;
  ports: PortConfig[];
} {
  const allPorts = getPorts();
  if (location === 'PORT_KLANG') {
    const wp = allPorts.find((p) => p.code === 'WESTPORT' || p.id === 'pk-westport') || {
      id: 'pk-westport',
      location: 'PORT_KLANG' as PortLocation,
      display_name: 'WESTPORT',
      code: 'WESTPORT',
      backend_port_id: '5ad78eeb458efa4c5a1fc007',
      active: true,
    };
    const np = allPorts.find((p) => p.code === 'NORTHPORT' || p.id === 'pk-northport') || {
      id: 'pk-northport',
      location: 'PORT_KLANG' as PortLocation,
      display_name: 'NORTHPORT',
      code: 'NORTHPORT',
      backend_port_id: '5adc9dd77753d26fb07d6f26',
      active: true,
    };
    const ids = [wp.backend_port_id, np.backend_port_id].filter(Boolean);
    return {
      location,
      portNames: ['WESTPORT', 'NORTHPORT'],
      backendIdsString: ids.join(','),
      ports: [wp, np] as PortConfig[],
    };
  } else {
    const jhPorts = allPorts.filter((p) => p.location === 'JOHOR');
    const ids = jhPorts.map((p) => p.backend_port_id).filter(Boolean);
    return {
      location,
      portNames: jhPorts.map((p) => p.display_name),
      backendIdsString: ids.join(','),
      ports: jhPorts,
    };
  }
}

export function getDepots(): DepotConfig[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DEPOTS);
    return raw ? JSON.parse(raw) : INITIAL_DEPOTS;
  } catch {
    return INITIAL_DEPOTS;
  }
}

export function saveDepot(depot: DepotConfig): void {
  const depots = getDepots();
  const index = depots.findIndex((d) => d.id === depot.id);
  if (index >= 0) {
    depots[index] = depot;
  } else {
    depots.push(depot);
  }
  localStorage.setItem(STORAGE_KEYS.DEPOTS, JSON.stringify(depots));
  syncDepot(depot);
  notifyListeners();
}

export function updateDepotConfig(
  depotId: string,
  updates: Partial<DepotConfig>
): DepotConfig | null {
  const depots = getDepots();
  const index = depots.findIndex((d) => d.id === depotId);
  if (index < 0) return null;
  depots[index] = { ...depots[index], ...updates };
  localStorage.setItem(STORAGE_KEYS.DEPOTS, JSON.stringify(depots));
  syncDepot(depots[index]);
  notifyListeners();
  return depots[index];
}

export function deleteDepotConfig(depotId: string): boolean {
  const depots = getDepots().filter((depot) => depot.id !== depotId);
  localStorage.setItem(STORAGE_KEYS.DEPOTS, JSON.stringify(depots));
  void deleteSupabaseRow('depot_configs', depotId);
  notifyListeners();
  return true;
}

// ==================== COMPANIES (COMPANY MASTER) ====================

export function getCompanies(): Company[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.COMPANIES);
    const companies: Company[] = raw ? JSON.parse(raw) : INITIAL_COMPANIES;
    const normalized = companies.map((company) => ({
      ...company,
      company_type: normalizeCompanyType(company.company_type),
    }));
    if (raw && JSON.stringify(companies) !== JSON.stringify(normalized)) {
      localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return INITIAL_COMPANIES;
  }
}

export function getCompanyById(id: string): Company | undefined {
  const companies = getCompanies();
  return companies.find((c) => c.id === id);
}

/**
 * Primary lookup required by Requirement 2:
 * Search against the Admin Company Master database by Company Registration Number
 */
export function findCompanyByRegNo(regNo: string): Company | undefined {
  if (!regNo) return undefined;
  const normalized = normalizeRegNo(regNo);
  const companies = getCompanies();

  return companies.find((c) => {
    const cNorm = normalizeRegNo(c.registration_number);
    const cOldNorm = normalizeRegNo(c.registration_number_old || '');
    const cNewNorm = normalizeRegNo(c.registration_number_new || '');
    return cNorm === normalized || cOldNorm === normalized || cNewNorm === normalized;
  });
}

/**
 * Checks for duplicate normalized registration number (Section 4)
 */
export function checkDuplicateRegNo(regNo: string, excludeId?: string): boolean {
  const normalized = normalizeRegNo(regNo);
  const companies = getCompanies();
  return companies.some((c) => {
    if (excludeId && c.id === excludeId) return false;
    return normalizeRegNo(c.registration_number) === normalized;
  });
}

export function saveCompany(companyData: Partial<Company> & { registration_number: string; name: string }): Company {
  const companies = getCompanies();
  const now = new Date().toISOString();

  let target: Company;

  if (companyData.id) {
    const index = companies.findIndex((c) => c.id === companyData.id);
    if (index >= 0) {
      target = {
        ...companies[index],
        ...companyData,
        updated_at: now,
      };
      companies[index] = target;
    } else {
      target = {
        ...companyData,
        id: companyData.id || `comp-${Date.now()}`,
        status: companyData.status || 'ACTIVE',
        created_at: companyData.created_at || now,
        updated_at: now,
      } as Company;
      companies.push(target);
    }
  } else {
    target = {
      ...companyData,
      id: `comp-${Date.now()}`,
      status: companyData.status || 'ACTIVE',
      created_at: now,
      updated_at: now,
    } as Company;
    companies.push(target);
  }

  localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(companies));
  syncCompany(target);
  notifyListeners();
  return target;
}

/**
 * Requirement 12: Admin updates HAULIERID or FORWARDING_AGENT_ID directly
 */
export function updateCompanyId(
  companyId: string,
  idType: 'HAULIERID' | 'FORWARDING_AGENT_ID',
  idValue: string
): Company | null {
  const companies = getCompanies();
  const company = companies.find((c) => c.id === companyId);
  if (!company) return null;

  if (idType === 'HAULIERID') {
    company.haulier_id = idValue.trim();
  } else {
    company.forwarding_agent_id = idValue.trim();
  }
  company.updated_at = new Date().toISOString();

  localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(companies));
  syncCompany(company);

  // Automatically update any linked submissions status if they were blocked
  const submissions = getSubmissions();
  let updatedSubmissions = false;
  submissions.forEach((sub) => {
    if (sub.company_id === companyId && sub.status === 'PENDING') {
      sub.status = 'READY_TO_EXPORT';
      updatedSubmissions = true;
    }
  });

  if (updatedSubmissions) {
    localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(submissions));
    submissions.filter((submission) => submission.company_id === companyId && submission.status === 'READY_TO_EXPORT').forEach(syncSubmission);
  }

  notifyListeners();
  return company;
}

// ==================== SUBMISSIONS ====================

export function getSubmissions(): RegistrationSubmission[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUBMISSIONS);
    const list: RegistrationSubmission[] = raw ? JSON.parse(raw) : INITIAL_SUBMISSIONS;
    list.forEach((sub) => {
      sub.company_type = normalizeCompanyType(sub.company_type);
      if (sub.data?.company) {
        sub.data.company.company_type = normalizeCompanyType(sub.data.company.company_type);
      }
    });
    // Normalize arrays if legacy single objects exist
    list.forEach((sub) => {
      if (sub.data) {
        if (sub.data.driver && (!sub.data.drivers || sub.data.drivers.length === 0)) {
          sub.data.drivers = [sub.data.driver];
        }
        if (sub.data.trailer && (!sub.data.trailers || sub.data.trailers.length === 0)) {
          sub.data.trailers = [sub.data.trailer];
        }
        if (sub.data.vehicle && (!sub.data.vehicles || sub.data.vehicles.length === 0)) {
          sub.data.vehicles = [sub.data.vehicle];
        }
      }
    });
    return list;
  } catch {
    return INITIAL_SUBMISSIONS;
  }
}

export function getSubmissionById(id: string): RegistrationSubmission | undefined {
  const subs = getSubmissions();
  return subs.find((s) => s.id === id);
}

export function saveSubmission(
  submission: Omit<RegistrationSubmission, 'id' | 'reference_no' | 'submitted_at'>
): RegistrationSubmission {
  const subs = getSubmissions();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);

  const reference_no = `REG-${yyyy}${mm}${dd}-${randomSuffix}`;
  const newSubmission: RegistrationSubmission = {
    ...submission,
    id: `sub-${Date.now()}-${randomSuffix}`,
    reference_no,
    submitted_at: now.toISOString(),
  };

  subs.unshift(newSubmission);
  localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(subs));
  syncSubmission(newSubmission);
  notifyListeners();
  return newSubmission;
}

export function updateSubmissionStatus(
  submissionId: string,
  status: SubmissionStatus,
  notes?: string
): RegistrationSubmission | null {
  const subs = getSubmissions();
  const sub = subs.find((s) => s.id === submissionId);
  if (!sub) return null;

  sub.status = status;
  if (status === 'REVIEWED' && !sub.reviewed_at) {
    sub.reviewed_at = new Date().toISOString();
  }
  if (notes !== undefined) {
    sub.admin_notes = notes;
  }

  localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(subs));
  syncSubmission(sub);
  notifyListeners();
  return sub;
}

export function markSubmissionsExported(
  submissionIds: string[],
  filename: string
): void {
  const subs = getSubmissions();
  const now = new Date().toISOString();

  subs.forEach((s) => {
    if (submissionIds.includes(s.id)) {
      s.status = 'EXPORTED';
      s.exported_at = now;
      s.export_filename = filename;
    }
  });

  localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(subs));
  submissionIds.forEach((id) => {
    const updated = subs.find((submission) => submission.id === id);
    if (updated) syncSubmission(updated);
  });
  notifyListeners();
}

export function deleteSubmission(id: string): void {
  const subs = getSubmissions().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(subs));
  void deleteSupabaseRow('registration_submissions', id);
  notifyListeners();
}

export const DEFAULT_HAULIER_GUIDELINE: HaulierGuideline = {
  title: 'Haulier (Container) Registration Guideline & Port Protocols',
  subtitle: 'Official standard operating procedures & credentialing requirements for commercial container haulage operators entering Westport, Northport, and Johor inland depots.',
  badge: 'PORT TERMINAL DIRECTIVE',
  notice_banner: 'Port Klang terminal gates (Westport & Northport) require licensed Haulier Carrier gate credentials via direct port authority pass and container clearance systems. Forwarders and Conventional Transporters must register via the CargoMove portal.',
  last_updated: '2026-09-12T08:00:00.000Z',
  updated_by: 'Port Authority Admin',
  sections: [
    {
      id: 'scope',
      heading: '1. Scope & Regulatory Framework',
      content: 'This guideline governs all prime mover and container chassis haulage companies seeking gate pass entry into container terminal staging yards. Under National Port Terminal Security protocols, all container haulage operators must hold valid APAD (Commercial Vehicle Licensing Board) operator licenses and terminal-specific haulage agreements.',
      bullet_points: [
        'Applicable to 20ft, 40ft, 45ft ISO shipping container movers and dangerous cargo (DG) hauliers.',
        'Requires authorized Haulier Code (HAULIERID) issued directly by terminal security administrations.',
        'Drivers and Prime Movers must possess valid Smart Card biometric terminal security credentials.',
      ],
    },
    {
      id: 'prerequisites',
      heading: '2. Mandatory Prerequisites & Documentation',
      content: 'Before an application for container haulier gate credentials can be submitted, your company must prepare and verify the following official corporate certifications:',
      bullet_points: [
        'SSM Certificate of Incorporation / Business Profile (within 3 months validity).',
        'APAD Haulage License (Lesen Pengendali Pengangkutan Barang - Kontena).',
        'Comprehensive Fleet Cargo Liability & Third-Party Terminal Property Damage Insurance (minimum RM 1,000,000 indemnity).',
        'Valid PUSPAKOM Certificate of Fitness for all registered Prime Movers and Chassis / Skeletal trailers.',
        'Depot Terminal User Agreement / EDI Interchange Agreement signed by company director.',
      ],
    },
    {
      id: 'procedure',
      heading: '3. Step-by-Step Haulier Onboarding Procedure',
      content: 'Follow these standard operational phases to establish gate clearance:',
      bullet_points: [
        'Phase A: Submit Company Master Registration & APAD permit copy to Port Security Gate Office.',
        'Phase B: Receive provisional Terminal Haulier Code (HAULIERID) and EDI mailbox access credentials.',
        'Phase C: Enroll commercial drivers for biometric security vetting and safety induction briefing.',
        'Phase D: Register active fleet RFID tags and chassis BDM tare weights in terminal weighbridge system.',
        'Phase E: Final activation & gate pass issuance for terminal ingress/egress.',
      ],
    },
    {
      id: 'compliance',
      heading: '4. Terminal Safety & Gate Rules',
      content: 'All hauliers entering container yards must strictly comply with Port Terminal Safety Bylaws:',
      bullet_points: [
        'Mandatory PPE: High-visibility safety vest, steel-toe safety boots, and hard hat must be worn at all times outside the truck cabin.',
        'Strict speed limit of 25 km/h inside container stacking blocks and RTG crane corridors.',
        'Twistlocks must only be unlocked/locked in designated unfastening / fastening staging bays.',
        'Mobile phone use while operating prime mover inside container yard is strictly prohibited.',
      ],
    },
  ],
  contact_info: {
    department: 'Central Port Security & Haulier Credentialing Department',
    email: 'haulier.licensing@cargomove-ports.gov.my',
    phone: '+60 3-3169 8000 / +60 7-253 5888',
    operating_hours: 'Monday – Friday: 08:30 – 17:30 (Gate Pass Office 24/7)',
    office_location: 'Gate 1 Administration Complex, Port Klang & Pasir Gudang Terminal Gate B',
  },
  downloads: [
    {
      id: 'dl-1',
      title: 'Haulier Container Gate Application Package (PDF)',
      description: 'Official form set including Director Undertaking, Vehicle Roster, and Security Clearance checklist.',
      file_type: 'PDF Document',
      file_size: '2.4 MB',
    },
    {
      id: 'dl-2',
      title: 'Terminal Safety & Biometric Pass Induction Guide',
      description: 'Mandatory driver safety training syllabus and smart card pass issuance requirements.',
      file_type: 'PDF Document',
      file_size: '1.8 MB',
    },
    {
      id: 'dl-3',
      title: 'EDI Container Message Specs & Gate Code Reference',
      description: 'Technical document for IT and fleet dispatch systems integration with gate OCR systems.',
      file_type: 'PDF Document',
      file_size: '950 KB',
    },
  ],
};

export function getHaulierGuideline(): HaulierGuideline {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HAULIER_GUIDELINE);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.HAULIER_GUIDELINE, JSON.stringify(DEFAULT_HAULIER_GUIDELINE));
      return DEFAULT_HAULIER_GUIDELINE;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse haulier guideline from storage:', err);
    return DEFAULT_HAULIER_GUIDELINE;
  }
}

export function saveHaulierGuideline(guideline: HaulierGuideline): HaulierGuideline {
  const updated: HaulierGuideline = {
    ...guideline,
    last_updated: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEYS.HAULIER_GUIDELINE, JSON.stringify(updated));
  void upsertSupabaseRow('haulier_guidelines', { id: 'default', content: updated });
  notifyListeners();
  return updated;
}

export function resetHaulierGuideline(): HaulierGuideline {
  localStorage.setItem(STORAGE_KEYS.HAULIER_GUIDELINE, JSON.stringify(DEFAULT_HAULIER_GUIDELINE));
  notifyListeners();
  return DEFAULT_HAULIER_GUIDELINE;
}

