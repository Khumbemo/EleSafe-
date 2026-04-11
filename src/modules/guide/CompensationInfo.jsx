import React from 'react';

export default function CompensationInfo() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-neutral-800 mb-2">Nagaland State Government Compensation (Ex-gratia)</h3>
        <ul className="space-y-1">
          <li className="flex justify-between border-b py-1"><span>Human death:</span> <span className="font-medium text-neutral-900">₹5,00,000</span></li>
          <li className="flex justify-between border-b py-1"><span>Permanent disability:</span> <span className="font-medium text-neutral-900">₹2,00,000 – ₹4,00,000</span></li>
          <li className="flex justify-between border-b py-1"><span>Grievous injury:</span> <span className="font-medium text-neutral-900">₹50,000 – ₹1,50,000</span></li>
          <li className="flex justify-between border-b py-1"><span>Simple injury:</span> <span className="font-medium text-neutral-900">₹25,000</span></li>
          <li className="flex justify-between border-b py-1"><span>Crop damage:</span> <span className="font-medium text-neutral-900 text-right">As assessed by range officer (per acre)</span></li>
          <li className="flex justify-between py-1"><span>House damage:</span> <span className="font-medium text-neutral-900 text-right">As assessed (replacement cost)</span></li>
        </ul>
      </div>

      <div className="bg-forest-50 p-3 rounded-lg border border-forest-100">
        <h3 className="font-bold text-forest-800 mb-2 text-sm">How to claim:</h3>
        <ol className="list-decimal pl-4 space-y-1 text-sm text-forest-900">
          <li>Report incident immediately (within 24 hours)</li>
          <li>Forest guard verifies and documents damage</li>
          <li>Submit claim form to Wokha Range Office</li>
          <li>Payment within 60 days of verification</li>
        </ol>
      </div>

      <div>
        <h3 className="font-bold text-neutral-800 mb-2 text-sm">Required documents:</h3>
        <ul className="list-disc pl-4 space-y-1 text-sm text-neutral-700">
          <li>Aadhaar card</li>
          <li>Incident report number (from this app)</li>
          <li>Medical certificate (for injuries)</li>
          <li>Land ownership proof (for crop damage)</li>
        </ul>
      </div>
    </div>
  );
}
