import React from 'react';
import { PhoneCall } from 'lucide-react';

const EMERGENCY_CONTACTS = [
  { name: 'Control Room (Wokha)', phone: '+919436000000', role: '24/7 Forest Helpline' },
  { name: 'DFO Wokha', phone: '+919436000001', role: 'Divisional Forest Officer' },
  { name: 'Range Officer (Baghty)', phone: '+919436000002', role: 'Range Forest Officer' },
  { name: 'Emergency Medical', phone: '108', role: 'Ambulance' },
  { name: 'Police Control', phone: '100', role: 'Wokha Police' },
];

export default function EmergencyContacts() {
  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      <div className="bg-forest-600 text-white p-6 sticky top-0 z-10 shadow-md">
        <div className="flex items-center gap-3 mb-2">
          <PhoneCall size={24} />
          <h1 className="text-2xl font-bold">Emergency Contacts</h1>
        </div>
        <p className="text-sm opacity-90">Important numbers for immediate help</p>
      </div>

      <div className="p-4 space-y-3">
        {EMERGENCY_CONTACTS.map((contact, idx) => (
          <a
            key={idx}
            href={`tel:${contact.phone}`}
            className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-neutral-200 active:bg-neutral-50"
          >
            <div>
              <h3 className="font-bold text-neutral-900 text-lg">{contact.name}</h3>
              <p className="text-sm text-neutral-500">{contact.role}</p>
              <p className="text-sm font-mono text-forest-600 mt-1">{contact.phone}</p>
            </div>
            <div className="bg-green-100 p-3 rounded-full text-green-600">
              <PhoneCall size={24} />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
