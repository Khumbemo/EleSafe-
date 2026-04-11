import React from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import { ChevronDown, BookOpen } from 'lucide-react';
import SafetyCards from './SafetyCards';
import CompensationInfo from './CompensationInfo';

export default function UserGuide() {
  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      <div className="bg-forest-600 text-white p-6 sticky top-0 z-10 shadow-md">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen size={24} />
          <h1 className="text-2xl font-bold">Safety Guide</h1>
        </div>
        <p className="text-sm opacity-90">Hati Bachaibole Niyom</p>
      </div>

      <div className="p-4 space-y-6">
        <section>
          <h2 className="text-xl font-bold text-neutral-900 mb-4 px-2">What to do when you see elephants</h2>
          <SafetyCards />
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
          <Accordion.Root type="single" collapsible className="w-full">

            <Accordion.Item value="item-1" className="border-b border-neutral-100 last:border-none">
              <Accordion.Header className="flex">
                <Accordion.Trigger className="flex-1 flex items-center justify-between p-4 text-left font-bold text-neutral-800 hover:bg-neutral-50 [&[data-state=open]>svg]:rotate-180">
                  <span>How to use HatiAlert</span>
                  <ChevronDown className="text-neutral-500 transition-transform duration-200" />
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="p-4 pt-0 text-neutral-600 text-sm leading-relaxed overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                <ol className="list-decimal pl-5 space-y-2">
                  <li><strong>Emergency:</strong> Tap the big red "REPORT" button at the bottom. Choose the icon that matches what is happening.</li>
                  <li><strong>Full Report:</strong> Go to the Reports tab to fill out details like herd size and photos.</li>
                  <li><strong>Offline Mode:</strong> You can submit reports even without internet. They will send automatically when you get signal.</li>
                  <li><strong>Alerts:</strong> Check the Alerts tab for warnings in your area. Your phone will also vibrate.</li>
                </ol>
              </Accordion.Content>
            </Accordion.Item>

            <Accordion.Item value="item-2" className="border-b border-neutral-100 last:border-none">
              <Accordion.Header className="flex">
                <Accordion.Trigger className="flex-1 flex items-center justify-between p-4 text-left font-bold text-neutral-800 hover:bg-neutral-50 [&[data-state=open]>svg]:rotate-180">
                  <span>Compensation Guidelines</span>
                  <ChevronDown className="text-neutral-500 transition-transform duration-200" />
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="p-4 pt-0 text-neutral-600 text-sm leading-relaxed">
                <CompensationInfo />
              </Accordion.Content>
            </Accordion.Item>

          </Accordion.Root>
        </section>
      </div>
    </div>
  );
}
