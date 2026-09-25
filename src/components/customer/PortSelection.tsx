import React from 'react';
import { PortLocation, PortConfig } from '../../types';
import { Anchor, Truck, Check, ArrowRight } from 'lucide-react';
import portHeroImage from '../../../media/registration-port-hero.png';
import depotCardImage from '../../../media/registration-depot-card.png';
import { Logo } from '../common/Logo';

interface PortSelectionProps {
  selectedLocation: PortLocation | null;
  onSelectLocation: (loc: PortLocation) => void;
  ports: PortConfig[];
  onNext: () => void;
  onSelectPortKlangDirect: () => void;
}

export function PortSelection({
  selectedLocation,
  onSelectLocation,
  onNext,
  onSelectPortKlangDirect,
}: PortSelectionProps) {
  const handlePortKlangClick = () => {
    onSelectLocation('PORT_KLANG');
  };

  const handleJohorClick = () => {
    onSelectLocation('JOHOR');
  };

  return (
    <div className="mx-auto max-w-[1080px] space-y-5">
      <div className="text-center space-y-1 pt-0 sm:pt-0">
        <h2 className="flex flex-wrap items-center justify-center gap-x-2 text-[28px] font-bold leading-tight text-[#102a56] sm:text-[32px] sm:leading-10">
          <span>What are you <span className="text-[#102a56]">registering</span></span>
          <Logo size="lg" className="shrink-0 self-center translate-y-1" />
          <span>for?</span>
        </h2>
        <p className="text-base leading-6 text-[#5b6b84]">Choose the option that matches your business.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Port Klang Card: PORT KLANG - CONVENTIONAL USER REGISTRATION */}
        <div
          onClick={handlePortKlangClick}
          className="group relative min-h-[300px] cursor-pointer overflow-hidden rounded-lg border border-[#d9e3ef] bg-white/92 p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] backdrop-blur transition duration-200 hover:-translate-y-0.5 sm:p-6"
        >
          <div className="pointer-events-none absolute right-0 top-0 hidden h-[140px] w-[190px] overflow-hidden rounded-bl-[64px] rounded-tl-[96px] rounded-tr-[7px] bg-sky-50 sm:block">
            <img src={portHeroImage} alt="" className="h-full w-full object-cover object-left" />
            <div className="absolute inset-0 bg-gradient-to-l from-transparent via-white/0 to-white/35" />
          </div>

          <div className="relative z-10 flex h-full flex-col justify-between">
            <div>
              <div className="mb-3 flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-sky-50 text-[#0095e8]">
                  <Anchor className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[23px] font-bold leading-tight text-[#102a56] sm:text-[24px]">PORT KLANG</h3>
                  <p className="text-base font-medium text-[#24477d]">Westport &amp; Northport</p>
                </div>
              </div>
              <p className="mt-2 text-sm text-[#45638e]">For Forwarders &amp; Transporters</p>

              <div className="mt-4 pt-3">
                <p className="mb-2 text-xs font-semibold text-[#5b6b84]">Common examples</p>
                <div className="space-y-2 text-xs text-[#5b6b84] sm:text-sm">
                  {['Transporter / Trucking companies', 'Freight forwarders'].map((item) => (
                    <div key={item} className="flex items-center gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[#0095e8]"><Check className="h-3.5 w-3.5" /></span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePortKlangClick();
                onSelectPortKlangDirect();
              }}
              className="mt-4 inline-flex h-[54px] w-full items-center justify-center gap-2 rounded-[9px] bg-[#0095e8] px-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#0078c8]"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Johor Card: JOHOR DEPOT - CONTAINER AND CONVENTIONAL REGISTRATION */}
        <div
          onClick={handleJohorClick}
          className="group relative min-h-[300px] cursor-pointer overflow-hidden rounded-lg border border-[#d9e3ef] bg-white/92 p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] backdrop-blur transition duration-200 hover:-translate-y-0.5 sm:p-6"
        >
          <div className="pointer-events-none absolute right-0 top-0 hidden h-[140px] w-[190px] overflow-hidden rounded-bl-[64px] rounded-tl-[96px] rounded-tr-[7px] bg-violet-50 sm:block">
            <img src={depotCardImage} alt="" className="h-full w-full object-cover object-center" />
            <div className="absolute inset-0 bg-gradient-to-l from-transparent via-white/0 to-white/35" />
          </div>

          <div className="relative z-10 flex h-full flex-col justify-between">
            <div>
              <div className="mb-3 flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                  <Truck className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[23px] font-bold leading-tight text-[#102a56] sm:text-[24px]">JOHOR DEPOT</h3>
                  <p className="text-base font-medium text-[#24477d]">ICS &amp; INFINITY PASIR GUDANG</p>
                </div>
              </div>
              <p className="mt-2 text-sm text-[#45638e]">For Container &amp; Conventional operations</p>

              <div className="mt-4 pt-3">
                <p className="mb-2 text-xs font-semibold text-[#5b6b84]">Common examples</p>
                <div className="space-y-2 text-xs text-[#5b6b84] sm:text-sm">
                  {['Container handling & terminal operations', 'Conventional cargo (bulk / general goods)'].map((item) => (
                    <div key={item} className="flex items-center gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[#0095e8]"><Check className="h-3.5 w-3.5" /></span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleJohorClick();
                onNext();
              }}
              className="mt-4 inline-flex h-[54px] w-full items-center justify-center gap-2 rounded-[9px] bg-[#0095e8] px-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#0078c8]"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

