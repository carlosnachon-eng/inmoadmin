// Shared with the existing review API: authenticated decryption with exact bindings.
export function projectReviews(rows,crypto,c){
 if(!Array.isArray(rows)||rows.length>200)throw Error('shape');
 return {rows:rows.map(r=>({...crypto.open(c,'commercial-review',[r.comment_ref,r.revision],r.decision_box),approved_text:r.approval_box?crypto.open(c,'commercial-approval',[r.comment_ref,r.revision,r.approved_by],r.approval_box).text:null,revision:r.revision,status:r.status,destination:r.destination,opportunity:r.opportunity,updated_at:r.updated_at})),sender:false,private_replies:false,
 metrics:{received:rows.length,pending:rows.filter(r=>['proposed','approved'].includes(r.status)).length,escalated:rows.filter(r=>r.status==='escalated').length,opportunities:rows.filter(r=>r.opportunity).length,accepted:rows.filter(r=>r.status==='accepted').length}};
}
