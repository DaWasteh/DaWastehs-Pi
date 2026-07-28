---
name: dualboot-separated-drives
description: Boot/EFI maintenance for the Windows 11 + Ubuntu 26.04 setup on Pandaking (MSI MEG Z890, nine drives). The two OSes live on SEPARATE physical drives, each with its OWN ESP and bootloader - fully isolated by design. MUST be consulted before ANY efibootmgr, grub-install, ESP, initramfs, os-prober, or partition operation.
---

# Dual-Boot on Separated Drives (Pandaking)

## Current architecture (deliberate design — do not "unify")
- Windows 11 and Ubuntu 26.04 are installed on **two different physical drives**, each with its **own ESP and own bootloader** (Windows Boot Manager on the Windows disk, GRUB on the Ubuntu disk).
- OS selection happens via the **F11 firmware boot menu** (or firmware boot order), NOT via a shared GRUB menu.
- Consequences to respect:
  - Never install GRUB onto the Windows disk's ESP, and never let the Windows installer/updater touch the Ubuntu ESP.
  - `os-prober` / Windows entries inside GRUB are unnecessary — keep `GRUB_DISABLE_OS_PROBER=true`; each disk boots only its own OS.
  - When (re)installing either OS, physically or in firmware isolate the other disk if possible, so the installer cannot place its bootloader on the wrong ESP (this exact failure caused the historic 3-ESP mess).
- Secure Boot is DISABLED (third-party kernel modules for ROCm workloads).

## Iron rules
1. **Never act on remembered device names or UUIDs.** With nine drives, NVMe enumeration can shift. Re-verify with `lsblk -o NAME,SIZE,FSTYPE,UUID,PARTUUID,MOUNTPOINT` and `blkid` immediately before ANY destructive step.
2. **Files before NVRAM.** The MSI firmware re-creates NVRAM entries for any ESP still containing `EFI\ubuntu\*.efi` on every boot scan. Cleanup order: remove stray `EFI/ubuntu` folders from foreign ESPs → then `efibootmgr -B` → then set BootOrder. `efibootmgr -B` alone never sticks.
3. **One ESP per OS, on that OS's own disk.** Any `EFI/ubuntu` on the Windows disk (or `EFI/Microsoft` duplication on the Ubuntu disk) is contamination and gets removed per rule 2.
4. NTFS data partitions can share disks with either OS — identify them by FSTYPE before deleting anything.

## Health check (run when boot entries look wrong)
```bash
sudo efibootmgr -v          # expect exactly: one Windows Boot Manager, one Ubuntu
lsblk -o NAME,SIZE,FSTYPE,UUID,PARTLABEL,MOUNTPOINT
findmnt /boot/efi           # must be the ESP on the Ubuntu disk
```
Target end state: exactly two firmware entries (Windows Boot Manager + Ubuntu), each pointing at its own disk's ESP.

## Recovery (Ubuntu drops to initramfs / grub> prompt)
Boot Ubuntu Live USB via F11, identify the Ubuntu root and its ESP with `lsblk`/`blkid` (rule 1), then:
```bash
sudo mount /dev/<ubuntu-root> /mnt
sudo mount /dev/<ubuntu-esp> /mnt/boot/efi
for d in dev dev/pts proc sys run; do sudo mount --bind /$d /mnt/$d; done
sudo chroot /mnt
update-initramfs -c -k all   # rebuilds initramfs incl. NVMe + USB-HID drivers
update-grub                  # regenerates grub.cfg with the correct root UUID
grub-install                 # reinstalls GRUB to the mounted (own-disk) ESP
```
Symptom notes: keyboard dead in initramfs/busybox but alive in firmware/GRUB = initramfs missing USB HID modules → rebuild as above. GRUB loading a grub.cfg with a wrong/old root UUID = leftover bootloader from a previous install on some other ESP → rule 2 cleanup.
