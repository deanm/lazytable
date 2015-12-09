"use strict";

function ZoomyKeyRepeater() {
  this.key = -1;
  this.count = 0;
  this.last_ts = 0;

  var this_ = this;
  this.fire_synthetic = function() {
    if (this_.key !== -1 && this_.count > 0) this_.on_key(this_.key);
  };
}

ZoomyKeyRepeater.prototype.reset = function(e) {
  this.key = -1;
  this.count = 0;
};

ZoomyKeyRepeater.prototype.feed_keydown = function(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;  // Don't eat the event.

  if (this.key === -1) {
    this.key = e.which;
    this.count = 0;
  } else if (this.key !== e.which) {
    this.reset();
  } else {
    ++this.count;
  }

  var multiplier = ((this.count / 20) | 0) + 1;

  // NOTE(deanm): We previously synthesized events, by setting a timer and
  // calling on_key() more often.  However usually this just ends up in a lot
  // more work and repainting that doesn't actually becoming visible, swamping
  // down the system.  The key repeat seems to already come in at a somewhat
  // reasonable framerate, we could perhaps double it by firing one extra
  // setTimeout(), but anything else seems to get beyond the point we can
  // actually repaint it.  So avoid all of the DOM updates and pass down a
  // multiplier which then means bigger steps can just be made.

  if (multiplier > 4) multiplier = 4;  // Cap it for now.

  if (this.on_key(e.which, multiplier) === false)  // No matter what call key.
    stopprop(e);

  this.last_ts = e.timeStamp
};

ZoomyKeyRepeater.prototype.feed_keyup = function(e) {
  // NOTE(deanm): Should save any setTimeout handles and clear them here, or
  // you might get one firing after a keyup, but anyway it will be handled by
  // the key check in fire_synthetic but still probably cleaner to cancel them.
  this.reset();
};

ZoomyKeyRepeater.prototype.make_keydown_handler = function() {
  var this_ = this;
  return function(e) { return this_.feed_keydown(e); };
};

ZoomyKeyRepeater.prototype.make_keyup_handler = function() {
  var this_ = this;
  return function(e) { return this_.feed_keyup(e); };
};

var kKeyCodeLeft  = 37;
var kKeyCodeUp    = 38;
var kKeyCodeRight = 39;
var kKeyCodeDown  = 40;

function LazyTable(row_height, num_rows, host_node, opts) {
  var this_ = this;

  opts = opts || { };

  var total_height = num_rows * row_height;

  function ce(name, styles, classname) {  // create element
    var e = document.createElement(name);
    if (classname) e.className = classname;
    if (!styles) return e;
    for (let key in styles) e.style[key] = styles[key];
    return e;
  }

  var div = ce('div');

  var hole0 = ce('div', {backgroundColor: 'blue', height: 0})
  var hole1 = ce('div', {backgroundColor: 'red',  height: total_height + 'px'})

  var a = 0, b = 0;  // Range of elements that rows are built for.

  this.move_selection = function(old_row, old_pos, new_row, new_pos) { };
  this.user_changed_selection = function(new_pos) { };

  var row_id_to_row = [ ];  // Indexed starting from `a`.

  function id_to_row(id) {
    if (id === null) return null;
    id = id - a;
    if (id < 0 || id >= row_id_to_row.length) return null;
    return row_id_to_row[id];
  }

  function id_to_node(id) {
    var row = id_to_row(id);
    return row ? row.node : null;
  }

  //   Layout within scroll parent (host_node)
  //
  // ..............        -                                     -
  // .            .        |   scrollTop                         |
  // .            .        |                                     |
  // +------------+  y2    -     -                               |
  // |            |              | clientHeight w/o scrollbar    | scrollHeight
  // |            |              | offsetHeight w/  scrollbar    |
  // +------------+  y3          -                               |
  // .            .                                              |
  // ..............                                              -
  //

  // Size of the host_node we are in (visible not content height).
  var host_height = 0;
  var host_width  = 0;
  var host_scrolltop = 0;  // TODO

  // --- Deferred / Coalesced DOM updates ---
  // Try to avoid forcing synchronous layouts.  When performing a scroll to a
  // specific position, we have to write and possibly read the scroll position
  // which could force a layout.  Coalesce the operations and do them when the
  // browser is going for a paint via requestAnimationFrame.
  var dom_dirty = false;

  var scroll_dirty = false;
  var scroll_pos_wanted = 0;
  var scroll_dirty_center = false;
  var cur_scrolltop = 0;

  var select_dirty = false;
  var select_wanted = null;
  var selected = null;

  function handle_dirty_select(p) {
    if (p === null) {  // clear selection
      this_.move_selection(id_to_row(selected), selected, null, null);
      selected = null;
      return;
    }

    if (p >= num_rows) p = num_rows-1;
    if (p < 0) p = 0;

    if (p === selected) return;  // selection didn't change

    this_.move_selection(id_to_row(selected), selected, id_to_row(p), p);
    selected = p;
  }

  function set_cur_scrolltop(st) {
    st = Math.floor(st);  // NOTE(deanm): Chrome truncates not rounds scrollTop.
    if (st > total_height - host_height) st = total_height - host_height;
    if (st < 0) st = 0;
    cur_scrolltop = st;
  }

  function do_center_scroll_pos(pos) {
    var y0 = pos * row_height + row_height / 2;
    set_cur_scrolltop(y0 - host_height / 2);
  }

  function do_ensure_scroll_pos(pos) {
    var y0 = pos * row_height, y1 = y0 + row_height;
    var y2 = cur_scrolltop, y3 = y2 + host_height;
    y0 -= row_height >> 2; y1 += row_height >> 2;  // Quarter height of margin.
    if      (y0 < y2) set_cur_scrolltop(y0);
    else if (y1 > y3) set_cur_scrolltop(y2 + y1 - y3);
  }

  function handle_dom_dirty() {
    if (!dom_dirty) return;
    dom_dirty = false;

    if (select_dirty) {
      handle_dirty_select(select_wanted);
      select_dirty = false;
    }

    if (scroll_dirty) {
      scroll_dirty_center ? do_center_scroll_pos(scroll_pos_wanted) :
                            do_ensure_scroll_pos(scroll_pos_wanted);
      // Updates the DOM elements for the calculated scroll before telling the
      // browser about that scroll.
      update_dom_for_scroll();
      // Now tell the browser.
      host_node.scrollTop = cur_scrolltop;
    }
  }

  function mark_dom_dirty() {
    if (dom_dirty) return;
    dom_dirty = true;
    requestAnimationFrame(handle_dom_dirty);
  }

  this.select = function(p) {
    select_wanted = p;
    select_dirty = true;
    mark_dom_dirty();
  };

  this.clear_selection = function() {
    this.select(null);
  };

  // Return position (row number) or null if no selection.
  this.get_selected_pos = function() {
    return selected;
  };

  var free_rows = [ ];  // Recycling.

  this.create_row = function() {
    return null;
  };

  this.configure_row = function(id, row) {
    return;
  };

  this.remove_row_from_node = function(n) {
    var id = n.row_id;
    var row = id === a ? row_id_to_row.shift() : row_id_to_row.pop();
    free_rows.push(row);  // Recycling
    div.removeChild(n);
  };

  function do_configure_node(id, row) {
    this_.configure_row(id, row);
    row.node.row_id = id;  // Map onto the actual DOM wrapper for event handling.
    // If the row was scrolled off the screen / deleted and so we are now
    // rebuilding the row that should be selected, notify.
    if (id === selected) this_.move_selection(null, id, row, id);
  }

  this.build_row_internal = function(id) {
    var row = free_rows.length ? free_rows.pop() : this.create_row();
    do_configure_node(id, row);
    return row;
  };

  function reconfigure_all_rows() {
    for (let c = a; c < b; ++c) {
      let row = row_id_to_row[c - a];
      do_configure_node(c, row);
    }
  }

  function remove_all_rows() {  // Collapse b to a, emptying all rows.
    while (b > a) {
      --b;
      this_.remove_row_from_node(hole1.previousSibling);
    }
    last_update_rows_in_view = {c: -1, d: -1};
  }

  function calc_rows_in_view() {
    // We want to compute which range of rows are visible, these will be
    // `c` to `d`.
    var c = cur_scrolltop / row_height | 0;
    var d = (cur_scrolltop + host_height + row_height) / row_height | 0;

    return {c: c, d: d};
  }

  this.user_select = function(pos) {
    this.ensure_scroll_pos(pos);
    this.select(pos);
    this.user_changed_selection(pos);
  };

  this.is_pos_fully_in_view = function(pos) {
    var scrolltop = cur_scrolltop;

    var y0 = pos * row_height, y1 = y0 + row_height;
    var y2 = scrolltop, y3 = y2 + host_height;
    return !(y0 < y2 || y1 > y3);
  };

  this.center_scroll_pos = function(pos) {
    scroll_pos_wanted = pos;
    scroll_dirty_center = true;
    scroll_dirty = true;
    mark_dom_dirty();
  };

  this.ensure_scroll_pos = function(pos) {
    // Don't override a center_scroll_pos().
    if (scroll_dirty && scroll_pos_wanted === pos) return;
    scroll_pos_wanted = pos;
    scroll_dirty_center = false;
    scroll_dirty = true;
    mark_dom_dirty();
  };

  var last_update_rows_in_view = {c: -1, d: -1};

  function update_hole_heights() {
    var hole0_height = a * row_height;
    var hole1_height = total_height - ((b - a) * row_height) - hole0_height;
    hole0.style.height = hole0_height + 'px';
    hole1.style.height = hole1_height + 'px';
    //document.title = div.childElementCount;
  }

  function update_dom_for_scroll() {
    //console.log('LazyTable update_dom_for_scroll ' + host_node.scrollTop);

    var cd = calc_rows_in_view();
    var c = cd.c, d = cd.d;

    // Early bailout if last update was for this exact range of rows.
    if (c === last_update_rows_in_view.c && d === last_update_rows_in_view.d)
      return;

    last_update_rows_in_view = cd;

    //console.log(['Update dom', a, b, c, d, free_rows.length, div.children.length]);

    //console.log([a, b, c, d]);

    c -= 10; d += 10;  // Some buffer
    if (c < 0) c = 0;
    if (d > num_rows) d = num_rows;
    if (d < c) d = c;

    //console.log([a, b, c, d, b - a, d - c]);

    // When we are moving to a completely new non-overlapping region, of the
    // same size, meaning something like a big page jump where everything is
    // invalidated, don't remove a bunch of DOM nodes just to add them back,
    // just leave everything in place an do a inplace rewrite reconfigure.
    if ((c > b || d < a) && d - c === b - a) {
      a = c; b = d;
      //console.log('short cutting node juggling, full reconfigure');
      reconfigure_all_rows();
    }

    while (a < c && a < b) {  // removing elements from the top
      this_.remove_row_from_node(hole0.nextSibling);
      ++a;
    }

    while (b > d && b > a) {  // removing elements from the bottom
      --b;
      this_.remove_row_from_node(hole1.previousSibling);
    }

    if (a === b) a = b = c;

    while (a > c) {  // adding elements to the top
      a--;
      var row = this_.build_row_internal(a);
      row_id_to_row.unshift(row);
      div.insertBefore(row.node, hole0.nextSibling);
    }

    while (b < d && b < num_rows) {  // adding elements to the bottom
      var row = this_.build_row_internal(b);
      row_id_to_row.push(row);
      div.insertBefore(row.node, hole1);
      ++b;
    }

    // How should the behavor work, if you scroll should the selection stay
    // in range? probably not...  That means that the selected element could
    // have no node, correct?
    //if (selected === null && a < num_rows) this_.select(a);
    update_hole_heights();
  }

/*
  div.addEventListener('keydown', function(e) {
    switch (e.which) {
      case kKeyCodeDown:  console.log('down'); return stopprop(e);
      case kKeyCodeUp:    console.log('up');   return stopprop(e);
      default: return;  // Don't stop prop.
    }
  }, true);  // FIXME using capturing, better / possible to use bubbling?
*/

  var repeater = new ZoomyKeyRepeater();

  repeater.on_key = function(code, multiplier) {
    var new_pos = selected === null ? 0 : selected;
    switch (code) {
      case kKeyCodeDown: case 74 /* J */: new_pos += multiplier; break;
      case kKeyCodeUp:   case 75 /* K */: new_pos -= multiplier; break;
      default: return;  // continue propigation
    }

    if (new_pos >= num_rows) new_pos = num_rows - 1;
    if (new_pos < 0) new_pos = 0;
    if (new_pos >= num_rows) new_pos = null;  // num_rows === 0
    if (new_pos !== selected) {
      this_.user_select(new_pos);
      this_.center_scroll_pos(new_pos);
    }

    return false;  // signal stopprop.
  };

  //host_node.setAttribute("tabindex", 0);  // Make focusable.

  // NOTE(deanm): Bad idea to attach to host_node unless we also have some
  // cleanup method to be able to detach.  Instead for now just allow the
  // caller to pump us...
  //host_node.addEventListener("keydown", repeater.make_keydown_handler());
  //host_node.addEventListener("keyup",   repeater.make_keyup_handler());

  this.on_keydown = repeater.make_keydown_handler();
  this.on_keyup   = repeater.make_keyup_handler();

  if (opts.no_click !== true) {
  div.addEventListener('click', (function() { return function(e) {
    for (var target = e.target; target !== div; target = target.parentNode) {
      var new_pos = target.row_id;
      if (new_pos !== undefined) {
        if (new_pos !== selected) {
          this_.user_select(new_pos);
        }
        break;
      }
    }
  };})());
  }

  div.appendChild(hole0);
  div.appendChild(hole1);

  this.data_changed = function(new_num_rows) {
    if (new_num_rows <= b) {  // Should cover 0 also.
      remove_all_rows();
      a = b = 0;
      update_hole_heights();
    } else {
      reconfigure_all_rows();
      last_update_rows_in_view = {c: -1, d: -1};
    }
    num_rows = new_num_rows;
    total_height = num_rows * row_height;
  };

  this.layout = function() {
    host_width  = host_node.clientWidth;
    host_height = host_node.clientHeight;
  };

  this.draw = function() {
    var scrolltop = host_node.scrollTop;
    var scroll_updated = scrolltop !== cur_scrolltop;
    if (scroll_updated) set_cur_scrolltop(scrolltop);
    update_dom_for_scroll();
    return scroll_updated;
  };

  var container = ce('div');
  container.className = "lazytable-container";
  container.appendChild(div);

  var de   = document.documentElement;
  var body = document.body;

  this.div = div;
  this.container = container;
}
