export type PortLocation = 'PORT_KLANG' | 'JOHOR' | 'OTHER';

export type RegistrationType = 'COMPANY' | 'DRIVER' | 'TRAILER' | 'VEHICLE';

export type CompanyCategory = 'HAULIER' | 'FORWARDING';

export type SubmissionStatus = 'PENDING' | 'DONE' | 'REJECTED';
export type RejectionReason = 'ALREADY_REGISTERED_BOTH' | 'NORTHPORT_ADDED' | 'OTHER';

export interface PortConfig {
  id: string;
  location: PortLocation;
  display_name: string;
  code: string;
  backend_port_id: string;
  active: boolean;
  description?: string;
}

export interface DepotConfig {
  id: string;
  port_id: string;
  display_name: string;
  backend_depot_id: string;
  active: boolean;
}

export interface Company {
  id: string;
  registration_number: string; // Primary lookup (e.g. AAAAAA-2)
  registration_number_old?: string;
  registration_number_new?: string;
  name: string;
  short_name: string;
  company_type: string; // Raw input (e.g. "Forwarder", "Haulage", "Transporter")
  haulier_id?: string;
  forwarding_agent_id?: string;
  port_id?: string;
  depot_id?: string;
  block?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  contact_name?: string;
  contact_email?: string;
  contact_designation?: string;
  contact_mobile?: string;
  office_phone?: string;
  fax?: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at: string;
}

export interface DriverData {
  driving_license: string;
  name: string;
  mobile_no: string;
}

export interface TrailerData {
  registration_number: string;
  weight: string;
  trailer_type: string;
  bdm_weight: string;
}

export interface VehicleData {
  registration_number: string;
  weight: string;
  bgk_weight: string;
  head: string;
}

export type CompanyFormData = Omit<Company, 'id' | 'created_at' | 'updated_at' | 'status'>;

export interface RegistrationSubmission {
  id: string;
  reference_no: string; // e.g. REG-20260914-A1B2C3D4E5F6
  registration_type: RegistrationType;
  company_id: string; // Links to Company Master
  company_reg_no: string;
  company_name: string;
  company_type: string;
  port_location: PortLocation;
  port_id: string;
  depot_id?: string;
  status: SubmissionStatus;
  rejection_reason?: RejectionReason | null;
  rejection_detail?: string | null;
  submitted_at: string;
  submitted_by_name: string;
  submitted_by_email: string;
  submitted_by_mobile: string;
  reviewed_at?: string;
  exported_at?: string;
  export_filename?: string;
  admin_notes?: string;
  data: {
    company?: Partial<CompanyFormData>;
    driver?: DriverData;
    trailer?: TrailerData;
    vehicle?: VehicleData;
    drivers?: DriverData[];
    trailers?: TrailerData[];
    vehicles?: VehicleData[];
    consent?: {
      declaration_accepted: true;
      data_processing_accepted: true;
      accepted_at: string;
      notice_version: string;
    };
  };
}

export interface UserRegistration {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  type: string;
  company_id: string;
  company_name: string;
  full_name: string;
  mobile_number: string;
  created_at: string;
}

export interface ExternalIdResolution {
  category: CompanyCategory;
  haulier_id: string;
  forwarding_agent_id: string;
  required_id_type: 'HAULIERID' | 'FORWARDING_AGENT_ID';
  has_required_id: boolean;
  active_id_value: string;
}

export interface GuidelineSection {
  id: string;
  heading: string;
  content: string;
  bullet_points?: string[];
}

export interface GuidelineContact {
  department: string;
  email: string;
  phone: string;
  operating_hours: string;
  office_location: string;
}

export interface GuidelineDownload {
  id: string;
  title: string;
  description: string;
  file_type: string;
  file_size: string;
}

export interface HaulierGuideline {
  title: string;
  subtitle: string;
  badge: string;
  notice_banner: string;
  last_updated: string;
  updated_by: string;
  sections: GuidelineSection[];
  contact_info: GuidelineContact;
  downloads: GuidelineDownload[];
}
