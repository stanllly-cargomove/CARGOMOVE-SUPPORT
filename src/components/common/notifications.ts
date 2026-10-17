import { toast, type ToastOptions } from 'react-hot-toast';

const warningStyle = {
  background: '#f59e0b',
  color: '#ffffff',
  border: '1px solid #fbbf24',
  borderRadius: '10px',
  boxShadow: '0 10px 25px rgba(120, 53, 15, 0.22)',
  fontSize: '13px',
  fontWeight: 700,
  minHeight: '46px',
  padding: '12px 18px',
};

const errorStyle = {
  background: '#dc2626',
  color: '#ffffff',
  border: '1px solid #ef4444',
  borderRadius: '10px',
  boxShadow: '0 10px 25px rgba(127, 29, 29, 0.24)',
  fontSize: '13px',
  fontWeight: 700,
  minHeight: '46px',
  padding: '12px 18px',
};

const successStyle = {
  background: '#16c968',
  color: '#ffffff',
  border: '1px solid #34d978',
  borderRadius: '10px',
  boxShadow: '0 10px 25px rgba(21, 128, 61, 0.22)',
  fontSize: '13px',
  fontWeight: 700,
  minHeight: '46px',
  padding: '12px 18px',
};

export function notifyWarning(message: string, options: ToastOptions = {}) {
  toast(message, {
    icon: '!',
    ...options,
    style: warningStyle,
    iconTheme: { primary: '#ffffff', secondary: '#f59e0b' },
  });
}

export function notifyError(message: string, options: ToastOptions = {}) {
  toast.error(message, {
    ...options,
    style: errorStyle,
    iconTheme: { primary: '#ffffff', secondary: '#dc2626' },
  });
}

export function notifySuccess(message: string, options: ToastOptions = {}) {
  toast.success(message, {
    ...options,
    style: successStyle,
    iconTheme: { primary: '#ffffff', secondary: '#16c968' },
  });
}

export function summarizeError(message: string) {
  const missingIdMatch = message.match(/missing required ([A-Z0-9_]+)/i);
  return missingIdMatch
    ? `Missing required ${missingIdMatch[1]}. Please add.`
    : message;
}
