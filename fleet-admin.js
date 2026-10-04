import { supabase } from './supabase.js';
const form=document.getElementById('carForm');
if(form) {
  let selectedFile=null;
  const preview=document.getElementById('previewImg');
  const wrapper=document.getElementById('imagePreview');
  const modal=document.getElementById('carModal');
  let objectUrl=null;
  function clearPreview() { if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;selectedFile=null;preview.removeAttribute('src');wrapper.style.display='none';document.getElementById('carImage').value=''; }
  window.removeImage=()=>{clearPreview();form.dataset.removeImage='true';};
  window.closeCarModal=()=>{modal.style.display='none';selectedFile=null;};
  document.getElementById('addCarBtn')?.addEventListener('click',()=>{
    form.reset();delete form.dataset.editId;delete form.dataset.removeImage;clearPreview();document.getElementById('modalTitle').textContent='Add New Car';modal.style.display='flex';
  });
  // app.js dispatches this when opening an existing vehicle.
  form.addEventListener('fleet-edit',()=>{selectedFile=null;delete form.dataset.removeImage;document.getElementById('carImage').value='';});
  const choose=file=>{
    if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024) {alert('Choose a JPG, PNG or WebP image under 5 MB.');return;}
    if(objectUrl)URL.revokeObjectURL(objectUrl);
    selectedFile=file;objectUrl=URL.createObjectURL(file);preview.src=objectUrl;wrapper.style.display='block';delete form.dataset.removeImage;
  };
  const area=document.getElementById('fileUploadArea');
  const input=document.getElementById('carImage');
  area.tabIndex=0;area.setAttribute('role','button');area.setAttribute('aria-label','Upload vehicle image');
  area.addEventListener('click',()=>input.click());
  area.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}});
  area.addEventListener('dragover',e=>e.preventDefault());
  area.addEventListener('drop',e=>{e.preventDefault();choose(e.dataTransfer.files[0]);});
  input.addEventListener('change',()=>choose(input.files[0]));
  modal.addEventListener('click',e=>{if(e.target===modal)window.closeCarModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')window.closeCarModal();});
  form.addEventListener('submit',async e=>{
    e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='Saving…';
    try {
      if(!supabase || !window.saveCarToSupabase) throw new Error('Fleet storage is unavailable.');
      const securityDepositValue=document.getElementById('carSecurityDeposit')?.value;
      const securityDepositPence=securityDepositValue===''||securityDepositValue==null?null:Math.round(Number(securityDepositValue)*100);
      const data={model:document.getElementById('carModel').value.trim(),type:document.getElementById('carType').value,price_daily:Number(document.getElementById('carPrice').value),daily_rate_pence:Math.round(Number(document.getElementById('carPrice').value)*100),capacity:document.getElementById('carCapacity').value.trim(),payload:Number(document.getElementById('carPayload').value),description:document.getElementById('carDesc').value.trim(),security_deposit_pence:securityDepositPence,security_deposit_policy:document.getElementById('carSecurityPolicy')?.value.trim()||null,is_active:document.getElementById('carActive').checked};
      if(selectedFile) {
        const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[selectedFile.type];
        const path=`${crypto.randomUUID()}.${extension}`;
        const {error}=await supabase.storage.from('fleet-images').upload(path,selectedFile,{contentType:selectedFile.type,upsert:false});
        if(error)throw new Error('Image upload failed. Check the fleet-images storage configuration.');
        data.image_url=supabase.storage.from('fleet-images').getPublicUrl(path).data.publicUrl;
      } else if(form.dataset.removeImage==='true')data.image_url=null;
      else if(preview.getAttribute('src'))data.image_url=preview.getAttribute('src');
      if(form.dataset.editId) await window.updateCarInSupabase(form.dataset.editId,data);
      else await window.saveCarToSupabase(data);
      window.closeCarModal();form.reset();clearPreview();alert('Vehicle saved.');
    } catch(error) {alert(error.message);}
    finally {button.disabled=false;button.textContent='Save Car';}
  });
}
