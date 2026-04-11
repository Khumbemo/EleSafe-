import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function SafetyCards() {
  const dos = [
    { text: "Move uphill if possible — elephants prefer downhill paths", nag: "Pahar phale uthibi - Hati namibole mon jai" },
    { text: "Stay together in groups", nag: "Ekelog te thakibi" },
    { text: "Make loud noise from a safe distance (bang pots, blow horns)", nag: "Dhur para dangor awaz koribi" },
    { text: "Alert neighbors immediately", nag: "Osorkhan ke jaldi khobor dibi" },
    { text: "Report to HatiAlert immediately", nag: "HatiAlert te jaldi report koribi" },
  ];

  const donts = [
    { text: "Run in a straight line — zigzag or hide behind large trees", nag: "Sidha na-doribi - zigzag doribi ba dangor ghas pichete lukabi" },
    { text: "Try to photograph or approach the herd", nag: "Photo lobole ba osorte na-jabi" },
    { text: "Corner or block the elephant's path", nag: "Hati laga rasta na-bondh koribi" },
    { text: "Use fire crackers near young calves — they panic the herd", nag: "Bacha osorte bom na-phutabi - ma-baba khong uthibo" },
    { text: "Go to fields at night without a group during alert period", nag: "Rati kheti te akela na-jabi alert thaka time te" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="text-green-600" />
          <h3 className="font-bold text-green-800 text-lg">DO'S (Koribole)</h3>
        </div>
        <ul className="space-y-3">
          {dos.map((item, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="text-green-600 font-bold mt-0.5">✓</span>
              <div>
                <p className="text-sm font-medium text-neutral-800">{item.text}</p>
                <p className="text-xs text-neutral-500">{item.nag}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <XCircle className="text-red-600" />
          <h3 className="font-bold text-red-800 text-lg">DON'TS (Na-koribole)</h3>
        </div>
        <ul className="space-y-3">
          {donts.map((item, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="text-red-600 font-bold mt-0.5">✗</span>
              <div>
                <p className="text-sm font-medium text-neutral-800">{item.text}</p>
                <p className="text-xs text-neutral-500">{item.nag}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
